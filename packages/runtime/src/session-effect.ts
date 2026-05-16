// Effect-shaped surface over the legacy {@link SessionContext} class.
//
// The legacy {@link SessionContext} owns the v1.1 §6 session phase machine
// plus the I/O seam (transport send / inbound dispatch) and is consumed by
// `ARCPServer` for protocol conformance. Rather than rewrite its internals
// — which would risk breaking the 35+ integration tests that pin
// behavior — this module exposes an `Effect`-typed twin
// (`SessionContextService`) that delegates to a backing `SessionContext`
// supplied at layer construction time.
//
// Ops live on the typed-error channel so call sites composing inside
// `Effect.gen` don't need `Effect.tryPromise` boilerplate. The watchdog and
// outbound back-pressure logic remain in the legacy class (it owns the
// transport).

import {
  type EventSeq,
  type JobId,
  type TaggedSdkError,
  type TaggedUnauthenticated,
  taggedFromARCP,
} from "@arcp/core";
import type { BaseEnvelope } from "@arcp/core/envelope";
import { ARCPError as ARCPErrorClass } from "@arcp/core/errors";
import type { JobErrorPayload } from "@arcp/core/messages";
import { Effect, Layer } from "effect";

// Doc-only reference: SessionContext is the concrete legacy class this
// service is designed around. See `./session-context.ts`.

/**
 * Structural subset of `SessionContext` the Effect twin actually touches.
 * Exposed so tests (and any future non-class backing) can supply a minimal
 * stub without instantiating the full class graph.
 */
export interface SessionContextLike {
  readonly state: { requireAccepted(): void };
  readonly transport: { readonly closed: boolean };
  readonly negotiatedFeatures: readonly string[];
  readonly latestEventSeq: EventSeq;
  nextEventSeq(): EventSeq;
  recordAck(seq: number): void;
  send(env: BaseEnvelope): Promise<void>;
  emitJobError(jobId: JobId, payload: JobErrorPayload): Promise<void>;
}

/**
 * Operation set exposed by {@link SessionContextService}. Mirrors the
 * legacy class methods that runtime/server pipelines need to invoke from
 * inside an Effect graph.
 */
export interface SessionContextEffect {
  /** Send an envelope through the transport. Failures surface on the typed channel. */
  readonly send: (env: BaseEnvelope) => Effect.Effect<void, TaggedSdkError>;
  /** Increment and return the next session-scoped `event_seq` (§8.3). */
  readonly nextEventSeq: Effect.Effect<EventSeq>;
  /** Current latest `event_seq` without advancing. */
  readonly latestEventSeq: Effect.Effect<EventSeq>;
  /** Fail with {@link TaggedUnauthenticated} unless session phase is `accepted`. */
  readonly requireAccepted: Effect.Effect<void, TaggedUnauthenticated>;
  /** Record an inbound `session.ack` for §6.5 back-pressure tracking. */
  readonly recordAck: (seq: number) => Effect.Effect<void>;
  /** Emit a `job.error` envelope (best-effort; legacy swallows transport errors). */
  readonly emitJobError: (
    jobId: JobId,
    payload: JobErrorPayload,
  ) => Effect.Effect<void>;
  /** Snapshot the negotiated v1.1 feature list. */
  readonly negotiatedFeatures: Effect.Effect<readonly string[]>;
  /** Whether the session has terminally closed. */
  readonly isClosed: Effect.Effect<boolean>;
}

/**
 * Effect-shaped twin of {@link SessionContext}. Use
 * {@link sessionContextLayer} to bind a layer instance to a specific
 * legacy session; the `.Default` stub fails every op with
 * {@link TaggedInvalidRequest} so unbound providers surface immediately
 * rather than silently no-oping.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const session = yield* SessionContextService
 *   yield* session.requireAccepted
 *   const seq = yield* session.nextEventSeq
 *   yield* session.send(buildEnvelope({...}))
 * }).pipe(Effect.provide(sessionContextLayer(legacySession)))
 * ```
 */
export class SessionContextService extends Effect.Service<SessionContextService>()(
  "arcp/SessionContextService",
  {
    succeed: unboundSessionContextStub(),
  },
) {}

function unboundSessionContextStub(): SessionContextEffect {
  // The default-provided stub is intentionally a defect (not a typed
  // failure) — using `SessionContextService` without binding a session via
  // `sessionContextLayer` is a configuration bug, not a runtime-recoverable
  // error. Defects surface as `Cause.Die` rather than polluting the typed
  // channel of every op.
  const die = (): Effect.Effect<never> =>
    Effect.die(
      "SessionContextService not bound; provide sessionContextLayer",
    );
  return {
    send: () => die(),
    nextEventSeq: die(),
    latestEventSeq: die(),
    requireAccepted: die(),
    recordAck: () => die(),
    emitJobError: () => die(),
    negotiatedFeatures: die(),
    isClosed: die(),
  };
}

/**
 * Build a {@link SessionContextService} layer backed by a legacy
 * {@link SessionContext}. Ops delegate through the legacy class so the
 * §6 phase machine, transport seam, and integration-tested watchdog
 * stay authoritative.
 */
export function sessionContextLayer(
  session: SessionContextLike,
): Layer.Layer<SessionContextService> {
  return Layer.succeed(
    SessionContextService,
    SessionContextService.make(makeSessionContextEffect(session)),
  );
}

/**
 * Construct the {@link SessionContextEffect} ops record for a given
 * legacy session. Exported alongside the layer factory so call sites that
 * already hold the legacy instance can bridge to Effect inline.
 */
export function makeSessionContextEffect(
  session: SessionContextLike,
): SessionContextEffect {
  return {
    send: (env) => sendEffect(session, env),
    nextEventSeq: Effect.sync(() => session.nextEventSeq()),
    latestEventSeq: Effect.sync(() => session.latestEventSeq),
    requireAccepted: requireAcceptedEffect(session),
    recordAck: (seq: number) =>
      Effect.sync(() => {
        session.recordAck(seq);
      }),
    emitJobError: (jobId, payload) =>
      Effect.promise(() => session.emitJobError(jobId, payload)),
    negotiatedFeatures: Effect.sync(() => session.negotiatedFeatures),
    isClosed: Effect.sync(() => session.transport.closed),
  };
}

function sendEffect(
  session: SessionContextLike,
  env: BaseEnvelope,
): Effect.Effect<void, TaggedSdkError> {
  return Effect.tryPromise({
    try: () => session.send(env),
    catch: (cause) => liftToTagged(cause),
  });
}

function requireAcceptedEffect(
  session: SessionContextLike,
): Effect.Effect<void, TaggedUnauthenticated> {
  return Effect.try({
    try: () => {
      session.state.requireAccepted();
    },
    catch: (cause) => liftToTagged(cause) as TaggedUnauthenticated,
  });
}

function liftToTagged(cause: unknown): TaggedSdkError {
  if (cause instanceof ARCPErrorClass) return taggedFromARCP(cause);
  throw cause as Error;
}
