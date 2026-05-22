// Effect-shape entry points layered ON TOP of the legacy `ARCPServer`.
//
// SCOPE DISCIPLINE: this module is purely additive. The legacy `ARCPServer`
// class (constructor + `registerAgent`/`accept`/`close`) is the published
// API and is the single source of truth for the §6 handshake, §7 job
// lifecycle, §6.5 back-pressure, §6.3 resume, etc. Forty-five SDK
// integration tests pin its behavior.
//
// What this module adds, intended for Effect-first consumers:
//
//   - {@link ARCPRuntimeLayer}: a `Layer` that wires the prior-slice Effect
//     services together (`IdGen`, `AgentRegistryService`,
//     `IdempotencyStoreService`, `ResumeStoreService`,
//     `BearerVerifierService`, optional `EventLogService`, and
//     `LoggerLayer`). The layer is independent of the legacy class — it is
//     a composition of the already-tested services.
//   - {@link ARCPServerService}: a `Layer.scoped`-built service holding a
//     legacy {@link ARCPServer} instance. Lifecycle is bound to the layer's
//     scope so `ManagedRuntime.dispose()` deterministically calls
//     `server.close()` (closes the SQLite event log + clears the resume
//     sweep `setInterval`).
//   - {@link acceptSessionEffect}: adapts a {@link TransportEffect} into the
//     legacy {@link Transport} shape and hands it to `server.accept`. The
//     handshake + dispatch loop are the legacy machinery — we never
//     re-implement them.
//   - {@link resumeSweepDaemon}: an Effect-native periodic sweeper for
//     {@link ResumeStoreService}, intended to be `Effect.forkScoped`-ed
//     inside a `ManagedRuntime` so it shuts down with the runtime. Closes
//     the daemon-lifecycle risk in #27.
//   - {@link makeARCPServerRuntime}: the convenience entry point — builds
//     the layer, wraps it in `ManagedRuntime.make`. Returned runtime
//     exposes `runPromise`/`runFork` for `acceptSessionEffect` etc.
//
// The legacy `ARCPServer` lifecycle (constructor `setInterval` sweep, plus
// `close()` cleanup) is NOT replaced. The {@link resumeSweepDaemon} is an
// OPT-IN second sweep available to Effect-graph callers that want to drive
// the cadence from a `Schedule`. Both are safe to run side by side: the
// `ResumeStoreService.sweep` op is idempotent (it walks the
// `SynchronizedRef` and drops expired entries).

import {
  type BearerIdentity,
  type BearerVerifier,
  BearerVerifierService,
  type EventLogEffect,
  EventLogService,
  IdGen,
  LoggerLayer,
  staticBearerVerifierLayer,
} from "@agentruntimecontrolprotocol/core";
import { UnauthenticatedError } from "@agentruntimecontrolprotocol/core/errors";
import type { Transport, TransportEffect } from "@agentruntimecontrolprotocol/core/transport";
import {
  Effect,
  Layer,
  ManagedRuntime,
  Schedule,
  type Scope,
  Stream,
} from "effect";

import { AgentRegistryService } from "./agent-registry.js";
import { ARCPServer } from "./server.js";
import { IdempotencyStoreService, ResumeStoreService } from "./stores.js";
import type { ARCPServerOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Options / public types
// ---------------------------------------------------------------------------

/**
 * Options for {@link ARCPRuntimeLayer} / {@link makeARCPServerRuntime}.
 *
 * Mirrors {@link ARCPServerOptions} verbatim and adds optional shortcuts for
 * the Effect-shaped services this layer composes:
 *
 *   - `bearerTable`: pass a `Map<token, BearerIdentity>` and the layer will
 *     install {@link staticBearerVerifierLayer} for you. Equivalent to
 *     passing `bearer: new StaticBearerVerifier(table)` to the legacy class.
 *   - `bearerVerifierLayer`: bring-your-own {@link BearerVerifierService}
 *     layer for JWKS/JOSE/etc. Takes precedence over `bearerTable`.
 *   - `eventLogLayer`: bring-your-own {@link EventLogService} layer. If
 *     omitted, the layer falls back to the default (unconfigured) service —
 *     the legacy {@link EventLog} attached to `ARCPServer` still backs all
 *     wire emission, so the missing service only affects pipelines that
 *     consume `EventLogService` directly.
 */
export interface ARCPRuntimeLayerOptions extends ARCPServerOptions {
  /**
   * Convenience: shortcut for {@link staticBearerVerifierLayer}. If both
   * this and {@link ARCPServerOptions.bearer} are supplied, the legacy class
   * uses `bearer` (for the handshake) and the Effect layer uses the table
   * — keep them in sync.
   */
  readonly bearerTable?: ReadonlyMap<string, BearerIdentity>;
  /** Bring-your-own {@link BearerVerifierService} layer (e.g. JWKS). */
  readonly bearerVerifierLayer?: Layer.Layer<BearerVerifierService>;
  /**
   * Bring-your-own {@link EventLogService} layer. When omitted the service
   * resolves to the default (fails-fast) implementation; the legacy
   * {@link EventLog} on `ARCPServer` is unaffected.
   */
  readonly eventLogLayer?: Layer.Layer<EventLogService>;
}

/**
 * Effect.Service tag holding the legacy {@link ARCPServer} instance bound by
 * {@link ARCPRuntimeLayer}. The instance's lifecycle is tied to the layer's
 * scope — `ManagedRuntime.dispose()` calls `server.close()` deterministically.
 *
 * Exposed so callers composing inside `Effect.gen` can yield* the server to
 * call legacy methods (e.g. `registerAgent`) without bridging through the
 * runtime's `runPromise` themselves.
 */
export class ARCPServerService extends Effect.Service<ARCPServerService>()(
  "arcp/ARCPServerService",
  {
    succeed: {
      server: null as ARCPServer | null,
    },
  },
) {}

// ---------------------------------------------------------------------------
// Layer builders
// ---------------------------------------------------------------------------

function bearerLayerFor(
  opts: ARCPRuntimeLayerOptions,
): Layer.Layer<BearerVerifierService> {
  if (opts.bearerVerifierLayer !== undefined) return opts.bearerVerifierLayer;
  if (opts.bearerTable !== undefined) {
    return staticBearerVerifierLayer(opts.bearerTable);
  }
  // Fall back to the service's default (fails every verify with
  // TaggedUnauthenticated). The legacy ARCPServer.handshake still consults
  // `opts.bearer` directly, so this only matters for Effect-graph callers.
  return BearerVerifierService.Default;
}

function eventLogServiceLayer(
  opts: ARCPRuntimeLayerOptions,
): Layer.Layer<EventLogService> {
  return opts.eventLogLayer ?? unconfiguredEventLogLayer();
}

const UNCONFIGURED_EVENT_LOG =
  "EventLogService not provided to ARCPRuntimeLayer";

function unconfiguredEventLogLayer(): Layer.Layer<EventLogService> {
  // The default-provided ops on `EventLogService` already fail-fast on every
  // method. We re-wrap them as an explicit layer here so the runtime layer
  // composition has a concrete `Layer<EventLogService>` to merge.
  const unconfigured: EventLogEffect = {
    append: () => Effect.die(UNCONFIGURED_EVENT_LOG),
    appendBatch: () => Effect.die(UNCONFIGURED_EVENT_LOG),
    replay: () => Stream.fail(UNCONFIGURED_EVENT_LOG).pipe(Stream.orDie),
    readSince: () => Effect.die(UNCONFIGURED_EVENT_LOG),
    readSinceSeq: () => Effect.die(UNCONFIGURED_EVENT_LOG),
    count: () => Effect.die(UNCONFIGURED_EVENT_LOG),
    getById: () => Effect.die(UNCONFIGURED_EVENT_LOG),
    query: () => Effect.die(UNCONFIGURED_EVENT_LOG),
  };
  return Layer.succeed(EventLogService, EventLogService.make(unconfigured));
}

/**
 * The legacy {@link ARCPServer} instance wrapped as a scoped resource: the
 * scope's `addFinalizer` calls `server.close()` so `ManagedRuntime.dispose`
 * deterministically clears the resume-sweep `setInterval` and closes the
 * SQLite event log. Closes the "leaked timer" risk called out in #27.
 */
function arcpServerScopedLayer(
  opts: ARCPRuntimeLayerOptions,
): Layer.Layer<ARCPServerService> {
  return Layer.scoped(
    ARCPServerService,
    Effect.gen(function* () {
      const server = yield* Effect.sync(() => makeLegacyServer(opts));
      yield* Effect.addFinalizer(() => Effect.promise(() => server.close()));
      return ARCPServerService.make({ server });
    }),
  );
}

// Optional-passthrough keys on `ARCPServerOptions` (everything except the
// two required `runtime` / `capabilities`). Listed once so
// `makeLegacyServer` can iterate; keeps the function's cyclomatic complexity
// in lint-bounds while preserving the exactOptionalPropertyTypes contract.
const PASSTHROUGH_KEYS = [
  "logger",
  "heartbeatIntervalSeconds",
  "resumeWindowSeconds",
  "cancelGraceMs",
  "idempotencyTtlMs",
  "caps",
  "features",
  "jobAuthorizationPolicy",
  "backPressureThreshold",
  "eventLog",
] as const satisfies readonly (keyof ARCPServerOptions)[];

function makeLegacyServer(opts: ARCPRuntimeLayerOptions): ARCPServer {
  // Pick the bearer for the legacy handshake: explicit `opts.bearer` wins;
  // otherwise synthesize a `BearerVerifier` from `bearerTable`. This keeps
  // the layer's `bearerTable` shortcut consistent across the Effect service
  // and the legacy handshake without forcing callers to supply both.
  const bearer = opts.bearer ?? bearerFromTable(opts.bearerTable);
  // exactOptionalPropertyTypes: only forward fields the caller supplied so
  // we never pass `undefined` for an optional slot. We narrow each key
  // through a small mutable map and then construct the final options object
  // — this keeps the per-field type intact without `any`.
  const carried: {
    [K in (typeof PASSTHROUGH_KEYS)[number]]?: ARCPServerOptions[K];
  } = {};
  for (const key of PASSTHROUGH_KEYS) {
    const value = opts[key];
    if (value === undefined) continue;
    assignPassthrough(carried, key, value);
  }
  const legacyOpts: ARCPServerOptions = {
    runtime: opts.runtime,
    capabilities: opts.capabilities,
    ...carried,
    ...(bearer === undefined ? {} : { bearer }),
  };
  return new ARCPServer(legacyOpts);
}

// Narrow assignment helper: TypeScript can prove the key/value relationship
// when the key is a single literal, but loses it across a union of keys.
// The generic parameter `K` collapses the union back to the matching slot.
function assignPassthrough<K extends (typeof PASSTHROUGH_KEYS)[number]>(
  target: { [P in (typeof PASSTHROUGH_KEYS)[number]]?: ARCPServerOptions[P] },
  key: K,
  value: ARCPServerOptions[K],
): void {
  target[key] = value;
}

function bearerFromTable(
  table: ReadonlyMap<string, BearerIdentity> | undefined,
): BearerVerifier | undefined {
  if (table === undefined) return undefined;
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    verify: async (token: string): Promise<BearerIdentity> => {
      const identity = table.get(token);
      if (identity === undefined) {
        throw new UnauthenticatedError("Unknown bearer token");
      }
      return identity;
    },
  };
}

/**
 * Compose every Effect service the Effect-shape runtime needs. The result is
 * a single `Layer` ready to feed {@link ManagedRuntime.make} or
 * {@link Effect.provide}. Composition (in order; later layers can depend on
 * earlier):
 *
 *   - {@link LoggerLayer} (pino bridge)
 *   - {@link IdGen}, {@link AgentRegistryService},
 *     {@link IdempotencyStoreService}, {@link ResumeStoreService} (`.Default`)
 *   - {@link BearerVerifierService} (from `bearerTable`, custom layer, or
 *     default fails-fast)
 *   - {@link EventLogService} (from `eventLogLayer` or default fails-fast)
 *   - {@link ARCPServerService} (scoped — bound legacy `ARCPServer`
 *     instance; finalizer calls `server.close()`)
 *
 * The legacy `ARCPServer` lifecycle is owned by the scope. Use the
 * returned layer with {@link ManagedRuntime.make} so `dispose()` fires
 * `server.close()` for you.
 */
export function ARCPRuntimeLayer(
  opts: ARCPRuntimeLayerOptions,
): Layer.Layer<
  | ARCPServerService
  | IdGen
  | AgentRegistryService
  | IdempotencyStoreService
  | ResumeStoreService
  | BearerVerifierService
  | EventLogService
> {
  const baseServices = Layer.mergeAll(
    IdGen.Default,
    AgentRegistryService.Default,
    IdempotencyStoreService.Default,
    ResumeStoreService.Default,
    bearerLayerFor(opts),
    eventLogServiceLayer(opts),
  );
  return Layer.mergeAll(LoggerLayer, baseServices, arcpServerScopedLayer(opts));
}

// ---------------------------------------------------------------------------
// Session acceptance (TransportEffect → legacy `Transport` → `ARCPServer`)
// ---------------------------------------------------------------------------

/**
 * Accept a single session driven by a {@link TransportEffect}. The
 * Effect-shape transport is adapted to the legacy {@link Transport}
 * interface and handed to `server.accept`; the legacy machinery owns the
 * handshake, dispatch loop, watchdog, back-pressure, and resume.
 *
 * Returns immediately after `server.accept` registers — the dispatch loop
 * runs on the transport's own driving fibers. Use the returned `Effect` in
 * an {@link Effect.fork} or {@link ManagedRuntime.runFork} call site if you
 * want to accept many sessions concurrently.
 *
 * @example
 * ```ts
 * const runtime = makeARCPServerRuntime({...})
 * const [clientSide, serverSide] = pairMemoryTransportsEffect()
 * await runtime.runPromise(acceptSessionEffect(serverSide))
 * // …drive the client side from clientSide.send / clientSide.incoming…
 * ```
 */
export function acceptSessionEffect(
  transport: TransportEffect,
): Effect.Effect<void, never, ARCPServerService> {
  return Effect.gen(function* () {
    const { server } = yield* ARCPServerService;
    if (server === null) {
      return yield* Effect.die(
        "ARCPServerService is not bound; use ARCPRuntimeLayer or makeARCPServerRuntime",
      );
    }
    const adapted = adaptTransportEffect(transport);
    server.accept(adapted);
  });
}

/**
 * Build a legacy {@link Transport} that delegates to a {@link TransportEffect}.
 *
 * - `send` runs the Effect's `send` synchronously via `Effect.runPromise`
 *   (the transport runs at the program edge, no enclosing fibers).
 * - `onFrame` / `onClose` are wired via `Effect.runFork`-ed stream
 *   consumption: the {@link TransportEffect.incoming} stream is run to
 *   completion in the background, dispatching frames to whoever registers a
 *   handler. Frames received before `onFrame` is registered are buffered so
 *   the handshake `session.hello` is not dropped.
 * - `close` runs the Effect's close.
 *
 * This is the only place the Effect-shape transport is bridged into the
 * legacy session loop, and intentionally lives next to the layer that
 * composes them so the bridge is easy to audit.
 */
function adaptTransportEffect(transport: TransportEffect): Transport {
  return new TransportEffectAdapter(transport);
}

class TransportEffectAdapter implements Transport {
  readonly #transport: TransportEffect;
  #frameHandler:
    | ((frame: Record<string, unknown>) => Promise<void> | void)
    | null = null;
  #closeHandler: ((err?: Error) => void) | null = null;
  readonly #buffered: Record<string, unknown>[] = [];
  #closed = false;
  #consumer: Promise<void> | null = null;

  public constructor(transport: TransportEffect) {
    this.#transport = transport;
  }

  public get closed(): boolean {
    return this.#closed || this.#transport.isClosed();
  }

  public async send(frame: Record<string, unknown>): Promise<void> {
    await Effect.runPromise(this.#transport.send(frame));
  }

  public onFrame(
    handler: (frame: Record<string, unknown>) => Promise<void> | void,
  ): void {
    if (this.#frameHandler !== null) {
      throw new Error("TransportEffectAdapter already has a frame handler");
    }
    this.#frameHandler = handler;
    if (this.#buffered.length > 0) {
      const drain = this.#buffered.splice(0);
      void drainBuffered(drain, handler);
    }
    this.#startConsumerIfNeeded();
  }

  public onClose(handler: (err?: Error) => void): void {
    this.#closeHandler = handler;
    this.#startConsumerIfNeeded();
  }

  public async close(_reason?: string): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Effect.runPromise(this.#transport.close);
  }

  #startConsumerIfNeeded(): void {
    if (this.#consumer !== null) return;
    const program = Stream.runForEach(this.#transport.incoming, (frame) =>
      Effect.sync(() => {
        const handler = this.#frameHandler;
        if (handler === null) {
          this.#buffered.push(frame);
          return;
        }
        void Promise.resolve(handler(frame));
      }),
    );
    this.#consumer = (async () => {
      try {
        await Effect.runPromise(program);
        this.#closed = true;
        this.#closeHandler?.();
      } catch (error) {
        this.#closed = true;
        const err = error instanceof Error ? error : new Error(String(error));
        this.#closeHandler?.(err);
      }
    })();
  }
}

async function drainBuffered(
  frames: Record<string, unknown>[],
  handler: (frame: Record<string, unknown>) => Promise<void> | void,
): Promise<void> {
  for (const frame of frames) {
    await handler(frame);
  }
}

// ---------------------------------------------------------------------------
// Resume-sweep daemon
// ---------------------------------------------------------------------------

/**
 * Periodic sweep of {@link ResumeStoreService} on an Effect-native cadence.
 *
 * Returns an Effect that repeats `ResumeStoreService.sweep(now)` every
 * `intervalMs` milliseconds. Intended to be `Effect.forkScoped`-ed inside a
 * scope (e.g. the scope owned by {@link ManagedRuntime}) so it terminates
 * when the scope closes — closing the "leaked sweep timer" risk in #27.
 *
 * Safe to run alongside the legacy `ARCPServer`'s built-in `setInterval`
 * sweep — the underlying op is idempotent and only drops entries past their
 * `expiresAt`.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   yield* Effect.forkScoped(resumeSweepDaemon(60_000))
 *   yield* acceptSessionEffect(transport)
 * })
 * ```
 */
export function resumeSweepDaemon(
  intervalMs: number,
): Effect.Effect<never, never, ResumeStoreService> {
  const tick = Effect.gen(function* () {
    const store = yield* ResumeStoreService;
    yield* store.sweep(Date.now());
  });
  // `Effect.repeat` on a `Schedule.fixed` schedule mirrors
  // `scheduleAtFixedInterval` semantics (Schedule.fixed schedules the next
  // tick at `start + n*interval`, skipping ticks that fall behind real
  // time). The success branch is unreachable — the cast records that.
  return tick.pipe(
    Effect.repeat(Schedule.fixed(`${intervalMs} millis`)),
  ) as Effect.Effect<never, never, ResumeStoreService>;
}

// ---------------------------------------------------------------------------
// ManagedRuntime convenience
// ---------------------------------------------------------------------------

/**
 * Build a {@link ManagedRuntime} preloaded with {@link ARCPRuntimeLayer}.
 *
 * The returned runtime owns the scope of the legacy {@link ARCPServer}
 * instance: call `runtime.dispose()` (or `await runtime.disposeEffect`) to
 * close the server (clears the resume sweep `setInterval` and the SQLite
 * event log) and release the bound Effect services.
 *
 * Effect-graph callers should drive sessions through this runtime:
 *
 * ```ts
 * const runtime = makeARCPServerRuntime({
 *   runtime: { name: "demo", version: "0.1.0" },
 *   capabilities: { encodings: ["json"] },
 *   bearerTable: new Map([["tok", { principal: "alice" }]]),
 * })
 * // Register agents through the bound server (still the legacy class):
 * await runtime.runPromise(
 *   Effect.gen(function* () {
 *     const { server } = yield* ARCPServerService
 *     server?.registerAgent("ping", async (i) => ({ echoed: i }))
 *   }),
 * )
 * const [client, server] = pairMemoryTransportsEffect()
 * await runtime.runPromise(acceptSessionEffect(server))
 * // …drive the client side…
 * await runtime.dispose()
 * ```
 */
export function makeARCPServerRuntime(
  opts: ARCPRuntimeLayerOptions,
): ManagedRuntime.ManagedRuntime<
  | ARCPServerService
  | IdGen
  | AgentRegistryService
  | IdempotencyStoreService
  | ResumeStoreService
  | BearerVerifierService
  | EventLogService,
  never
> {
  return ManagedRuntime.make(ARCPRuntimeLayer(opts));
}

// Note: convenience re-exports were intentionally omitted. Effect-shape
// consumers should import services (`IdGen`, `BearerVerifierService`,
// `EventLogService`, `LoggerLayer`, `staticBearerVerifierLayer`,
// `rootLogger`) directly from `@agentruntimecontrolprotocol/core`, and runtime services
// (`AgentRegistryService`, `IdempotencyStoreService`, `ResumeStoreService`,
// `ARCPServer`) from `@agentruntimecontrolprotocol/runtime`. Keeping the surface narrow avoids
// dual-import ambiguity.
// `Scope` is imported above as a type to keep `Layer.scoped`'s requirement
// callable from user code that composes additional scoped layers.
export type ScopeMarker = Scope.Scope;
