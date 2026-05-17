// Effect-shape entry points layered ON TOP of the legacy `ARCPClient`.
//
// SCOPE DISCIPLINE: this module is purely additive. The legacy `ARCPClient`
// class (constructor, `connect`, `submit`, `cancelJob`, `close`, `on`, plus
// v1.1 `ack`/`listJobs`/`subscribe`) is the published API and is the single
// source of truth for the §6 handshake, §7 job lifecycle, §6.5 ack
// scheduling, §6.6 list_jobs, §7.6 subscribe. Forty-five SDK integration
// tests pin its behavior.
//
// What this module adds, intended for Effect-first consumers:
//
//   - {@link ARCPClientService}: an `Effect.Service` tag holding a bound
//     legacy {@link ARCPClient} instance, exposing Effect-typed operations
//     (`submit`, `cancel`, `close`) that wrap the legacy Promise methods
//     under `Effect.tryPromise`. Pre-existing surface (`client.on`,
//     `client.connect`, etc.) remains reachable through `client` on the
//     service for callers that need it.
//   - {@link ARCPClientLayer}: builds the service as `Layer.scoped`. The
//     scope's finalizer calls `client.close()` so `ManagedRuntime.dispose()`
//     deterministically tears down the session.
//   - {@link makeARCPClientRuntime}: convenience wrapper around
//     {@link ManagedRuntime.make}.
//   - {@link subscribeEnvelopes}: turns the legacy single-handler-per-type
//     `client.on(type, handler)` callback API into a multi-subscriber
//     {@link Stream.Stream}. Closes risk #23 — the legacy `on()` callback
//     shape stays available, AND Effect consumers can fan out via Stream.
//
// The legacy `ARCPClient` is NOT replaced. Calls to `client.on(type, ...)`
// after `subscribeEnvelopes(type)` will REPLACE the multiplexer wrapper
// installed by this module — by design, the legacy `Map<string, ClientHandler>`
// is one-handler-per-type. Pick one shape per type per client.

import { type JobId, LoggerLayer } from "@arcp/core";
import type { Envelope } from "@arcp/core/messages";
import {
  type TaggedTransportError,
  transportSendError,
} from "@arcp/core/transport-error";
import { Effect, Layer, ManagedRuntime, type Scope, Stream } from "effect";

import { ARCPClient } from "./client.js";
import type { ARCPClientOptions, JobHandle, SubmitOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Service tag
// ---------------------------------------------------------------------------

/**
 * Operations exposed by {@link ARCPClientService}. The legacy
 * {@link ARCPClient} stays reachable through `client` so Effect-graph callers
 * can drop down to `client.connect(transport)`, `client.on(type, handler)`,
 * `client.ack(seq)`, `client.listJobs(...)`, etc. without re-implementing
 * those code paths.
 *
 * Effect-typed wrappers cover the three hottest call sites
 * (`submit`/`cancel`/`close`) so the common case stays inside the Effect
 * graph.
 */
export interface ARCPClientServiceShape {
  /** The bound legacy client. `null` only inside the default service. */
  readonly client: ARCPClient | null;
  /**
   * Effect-typed twin of `client.submit(opts)`. Errors from the legacy
   * client (`ARCPError`, `CancelledError`, transport failure) are surfaced
   * as `TaggedTransportError` with `kind: "send"`.
   */
  submit(opts: SubmitOptions): Effect.Effect<JobHandle, TaggedTransportError>;
  /**
   * Effect-typed twin of `client.cancelJob(jobId, { reason })`.
   */
  cancel(
    jobId: JobId,
    opts?: { reason?: string },
  ): Effect.Effect<void, TaggedTransportError>;
  /**
   * Effect-typed twin of `client.close(reason)`. Best-effort: maps any
   * underlying failure to `Effect.succeed(undefined)`.
   */
  readonly close: Effect.Effect<void>;
}

/**
 * Effect.Service tag holding the bound legacy {@link ARCPClient}. Built by
 * {@link ARCPClientLayer}; lifecycle is bound to the layer scope so
 * `ManagedRuntime.dispose()` calls `client.close()` deterministically.
 */
// `succeed` body — extracted so the literal can be typed explicitly as
// `ARCPClientServiceShape` (widening `client` from `null` to
// `ARCPClient | null`). Without the explicit annotation Effect.Service infers
// `client: null` and `ARCPClientService.make({ client })` rejects a non-null
// client.
const UNBOUND_MESSAGE =
  "ARCPClientService is not bound; use ARCPClientLayer or makeARCPClientRuntime";

const unboundError = (): TaggedTransportError =>
  transportSendError(new Error(UNBOUND_MESSAGE));

const UNBOUND: ARCPClientServiceShape = {
  client: null,
  submit: () => Effect.fail(unboundError()),
  cancel: () => Effect.fail(unboundError()),
  close: Effect.void,
};

export class ARCPClientService extends Effect.Service<ARCPClientService>()(
  "arcp/ARCPClientService",
  {
    succeed: UNBOUND,
  },
) {}

// ---------------------------------------------------------------------------
// Layer / runtime builders
// ---------------------------------------------------------------------------

/**
 * Build the {@link ARCPClientService} as a scoped resource. The scope's
 * finalizer calls `client.close()` so `ManagedRuntime.dispose()` (or any
 * `Effect.scoped` wrapping this layer) deterministically tears down the
 * session and clears the auto-ack timer.
 */
function arcpClientScopedLayer(
  opts: ARCPClientOptions,
): Layer.Layer<ARCPClientService> {
  return Layer.scoped(
    ARCPClientService,
    Effect.gen(function* () {
      const client = yield* Effect.sync(() => new ARCPClient(opts));
      yield* Effect.addFinalizer(() =>
        // close() swallows its own transport errors; we run as `Effect.promise`
        // because finalizers must not fail the scope.
        Effect.promise(() => client.close().catch(() => undefined)),
      );
      return ARCPClientService.make(makeShape(client));
    }),
  );
}

function makeShape(client: ARCPClient): ARCPClientServiceShape {
  return {
    client,
    submit: (opts) =>
      Effect.tryPromise({
        try: () => client.submit(opts),
        catch: transportSendError,
      }),
    cancel: (jobId, opts) =>
      Effect.tryPromise({
        try: () =>
          opts === undefined
            ? client.cancelJob(jobId)
            : client.cancelJob(jobId, opts),
        catch: transportSendError,
      }),
    close: Effect.promise(() => client.close().catch(() => undefined)),
  };
}

/**
 * Compose every Effect service the Effect-shape client needs.
 *
 *   - {@link LoggerLayer} — pino bridge for Effect-native logging.
 *   - {@link ARCPClientService} — scoped legacy client; finalizer closes the
 *     session.
 *
 * The returned layer is intended for {@link ManagedRuntime.make} or
 * {@link Effect.provide}. The legacy {@link ARCPClient} is the source of
 * truth; consumers that need the legacy callback or transport handshake call
 * through `service.client` after yielding the service.
 */
export function ARCPClientLayer(
  opts: ARCPClientOptions,
): Layer.Layer<ARCPClientService> {
  return Layer.mergeAll(LoggerLayer, arcpClientScopedLayer(opts));
}

/**
 * Build a {@link ManagedRuntime} preloaded with {@link ARCPClientLayer}.
 *
 * The returned runtime owns the legacy {@link ARCPClient} scope — calling
 * `runtime.dispose()` (or `await runtime.disposeEffect`) closes the session
 * and clears any auto-ack timer.
 *
 * @example
 * ```ts
 * const runtime = makeARCPClientRuntime({
 *   client: { name: "demo", version: "0.1.0" },
 *   authScheme: "bearer",
 *   token: "tok",
 * })
 * await runtime.runPromise(
 *   Effect.gen(function* () {
 *     const svc = yield* ARCPClientService
 *     // legacy connect — uses the bound client directly
 *     yield* Effect.promise(() => svc.client!.connect(transport))
 *     const handle = yield* svc.submit({ agent: "ping", input: 1 })
 *     return handle.jobId
 *   }),
 * )
 * await runtime.dispose()
 * ```
 */
export function makeARCPClientRuntime(
  opts: ARCPClientOptions,
): ManagedRuntime.ManagedRuntime<ARCPClientService, never> {
  return ManagedRuntime.make(ARCPClientLayer(opts));
}

// ---------------------------------------------------------------------------
// Envelope subscription (callback → Stream)
// ---------------------------------------------------------------------------

/**
 * Per-client × per-type set of Stream emitters. Keyed by the bound
 * {@link ARCPClient} instance so multiple clients hosted in the same process
 * (test pools, multi-tenant Effect graphs) stay isolated.
 *
 * A `WeakMap` lets the registry drop entries automatically once the client
 * is GC'd. The inner map is keyed by envelope type; the value is the set of
 * live emit functions installed by {@link subscribeEnvelopes}.
 */
type Emitter = (env: Envelope) => void;
const SUBSCRIBERS = new WeakMap<ARCPClient, Map<string, Set<Emitter>>>();

function emitterRegistry(client: ARCPClient): Map<string, Set<Emitter>> {
  let byType = SUBSCRIBERS.get(client);
  if (byType === undefined) {
    byType = new Map<string, Set<Emitter>>();
    SUBSCRIBERS.set(client, byType);
  }
  return byType;
}

/**
 * Fan-out handler installed once per (client, type) pair. Walks the live
 * emitter set in registration order — mirroring the FIFO semantics in the
 * issue's acceptance criterion ("observe all 3 called once in registration
 * order").
 */
function installFanoutHandler(
  client: ARCPClient,
  type: string,
  byType: Map<string, Set<Emitter>>,
): Set<Emitter> {
  const existing = byType.get(type);
  if (existing !== undefined) return existing;
  const emitters = new Set<Emitter>();
  byType.set(type, emitters);
  // Fire-and-forget: the legacy `ClientHandler` may return a Promise, but
  // we deliberately do not await per-subscriber processing (matches the
  // existing dispatch-loop semantics — handlers don't block dispatch).
  client.on(type, (env) => {
    for (const emit of emitters) emit(env);
  });
  return emitters;
}

/**
 * Subscribe to envelopes of a single `type` arriving on the bound client.
 * Returns a {@link Stream.Stream} that emits each matching envelope in
 * arrival order.
 *
 * Implementation: installs (once per client × type) a fan-out handler via
 * `client.on(type, ...)` that pushes into every live subscriber's emit
 * function. Multiple Stream subscribers on the same type share the
 * underlying handler.
 *
 * Risk #23 closure: the legacy `client.on(type, handler)` callback shape is
 * preserved and remains the documented one-handler-per-type primitive.
 * Effect consumers get a multi-subscriber Stream layered on top, with no
 * mutation of `ARCPClient` itself. If a caller installs their own
 * `client.on(type, ...)` AFTER `subscribeEnvelopes(type)` has been called,
 * the legacy `Map.set` semantics will replace the fan-out wrapper — by
 * design, since `on()`'s one-handler contract is the published behavior.
 *
 * The returned Stream never fails; its only termination is when the
 * underlying client closes (subscribers are cleaned up via the
 * `Stream.async` finalizer when the consumer fiber interrupts).
 */
export function subscribeEnvelopes(
  type: string,
): Stream.Stream<Envelope, never, ARCPClientService> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const { client } = yield* ARCPClientService;
      if (client === null) {
        return Stream.empty;
      }
      const byType = emitterRegistry(client);
      const emitters = installFanoutHandler(client, type, byType);
      return Stream.async<Envelope>((emit) => {
        const fn: Emitter = (env) => {
          // `emit.single` enqueues onto the Stream's unbounded buffer.
          void emit.single(env);
        };
        emitters.add(fn);
        // Clean up when the consumer fiber interrupts / the Stream is
        // discarded. Returning an Effect from the Stream.async callback
        // registers it as a finalizer.
        return Effect.sync(() => {
          emitters.delete(fn);
        });
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Re-exported `Scope` marker so callers composing additional scoped layers
// can name the requirement without a separate import.
// ---------------------------------------------------------------------------

export type ScopeMarker = Scope.Scope;
