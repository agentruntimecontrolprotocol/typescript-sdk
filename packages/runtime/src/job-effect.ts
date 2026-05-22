// Effect-shaped surfaces over the legacy {@link Job} and {@link JobManager}.
//
// As with `session-effect.ts`, the legacy `Job` class owns the
// integration-tested §7/§8 wire emission, watchdog timing, and state
// machine; rewriting its internals would risk the 35+ SDK integration
// tests that pin behavior. This module exposes `Effect`-typed twins
// (`JobService` per-job, `JobManagerService` per-session) that delegate
// to a backing `Job`/`JobManager` supplied at layer construction.
//
// Additionally exposed is {@link watchdogEffect}: an Effect-native
// heartbeat watchdog that complements (does not replace) the legacy
// `setTimeout`-driven watchdog inside `Job`. It is intended for new
// Effect-graph callers that want a typed `TaggedHeartbeatLost` failure
// without bridging `AbortSignal` manually. Reset semantics use a
// `Ref<Instant>` deadline polled by a `Schedule.fixed("250 millis")`
// fiber, matching the 250 ms resolution called out in #44.

import {
  type JobId,
  TaggedHeartbeatLost,
  type TaggedInvalidRequest,
  type TaggedSdkError,
  taggedFromARCP,
} from "@agentruntimecontrolprotocol/core";
import { ARCPError as ARCPErrorClass } from "@agentruntimecontrolprotocol/core/errors";
import type {
  JobErrorPayload,
  JobResultPayload,
  JobStateName,
} from "@agentruntimecontrolprotocol/core/messages";
import { Effect, Layer, Ref, Schedule } from "effect";

// Doc-only reference: Job/JobManager are the concrete legacy classes this
// service is designed around. See `./job.ts`.

/**
 * Structural subset of `Job` this twin actually touches. Exposed so tests
 * can supply a minimal stub.
 */
export interface JobLike {
  readonly jobId: JobId;
  readonly state: JobStateName;
  readonly isTerminal: boolean;
  emitAccepted(): Promise<void>;
  emitRunning(): Promise<void>;
  emitEventKind(kind: string, body: unknown): Promise<void>;
  emitResult(result: JobResultPayload): Promise<void>;
  emitErrorEnvelope(payload: JobErrorPayload): Promise<void>;
  transition(next: JobStateName): void;
  markHeartbeat(): void;
  cancel(reason: string): void;
  abortHard(reason: string): void;
}

/** Structural subset of {@link JobManager} this twin actually touches. */
export interface JobManagerLike {
  register(job: JobLike): void;
  get(jobId: string): JobLike | undefined;
  has(jobId: string): boolean;
  retire(jobId: string): void;
  list(): readonly JobLike[];
  cancelAll(reason: string): number;
  abortAll(reason: string): void;
}

/**
 * Per-job operations exposed by {@link JobService}. Delegates straight to
 * the backing {@link Job}; the only translation is the throw→typed-error
 * lift via {@link taggedFromARCP}.
 */
export interface JobEffect {
  readonly jobId: JobId;
  readonly emitAccepted: Effect.Effect<void, TaggedSdkError>;
  readonly emitRunning: Effect.Effect<void, TaggedSdkError>;
  readonly emitEventKind: (
    kind: string,
    body: unknown,
  ) => Effect.Effect<void, TaggedSdkError>;
  readonly emitResult: (
    result: JobResultPayload,
  ) => Effect.Effect<void, TaggedSdkError>;
  readonly emitErrorEnvelope: (
    payload: JobErrorPayload,
  ) => Effect.Effect<void, TaggedSdkError>;
  readonly transition: (
    next: JobStateName,
  ) => Effect.Effect<void, TaggedInvalidRequest>;
  readonly markHeartbeat: Effect.Effect<void>;
  readonly cancel: (reason: string) => Effect.Effect<void>;
  readonly abortHard: (reason: string) => Effect.Effect<void>;
  readonly state: Effect.Effect<JobStateName>;
  readonly isTerminal: Effect.Effect<boolean>;
}

/** Per-job-manager operations exposed by {@link JobManagerService}. */
export interface JobManagerEffect {
  readonly register: (job: JobLike) => Effect.Effect<void>;
  readonly get: (jobId: string) => Effect.Effect<JobLike | undefined>;
  readonly has: (jobId: string) => Effect.Effect<boolean>;
  readonly retire: (jobId: string) => Effect.Effect<void>;
  readonly list: Effect.Effect<readonly JobLike[]>;
  readonly cancelAll: (reason: string) => Effect.Effect<number>;
  readonly abortAll: (reason: string) => Effect.Effect<void>;
}

/**
 * Effect-shaped twin of the per-job state machine. Bind via
 * {@link jobLayer}; the `.Default` stub is a defect (configuration bug),
 * not a typed failure.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const job = yield* JobService
 *   yield* job.emitAccepted
 *   yield* job.emitRunning
 *   yield* job.emitEventKind("status", { phase: "halfway" })
 *   yield* job.emitResult({ final_status: "success", result: 42 })
 * }).pipe(Effect.provide(jobLayer(legacyJob)))
 * ```
 */
export class JobService extends Effect.Service<JobService>()(
  "arcp/JobService",
  { succeed: unboundJobStub() },
) {}

/** Effect-shaped twin of {@link JobManager}. */
export class JobManagerService extends Effect.Service<JobManagerService>()(
  "arcp/JobManagerService",
  { succeed: unboundJobManagerStub() },
) {}

/**
 * Build a {@link JobService} layer backed by a legacy {@link Job}. Ops
 * delegate through the legacy class so the §7/§8 wire emission and
 * integration-tested watchdog timing stay authoritative.
 */
export function jobLayer(job: JobLike): Layer.Layer<JobService> {
  return Layer.succeed(JobService, JobService.make(makeJobEffect(job)));
}

/** Build a {@link JobManagerService} layer backed by a legacy {@link JobManager}. */
export function jobManagerLayer(
  manager: JobManagerLike,
): Layer.Layer<JobManagerService> {
  return Layer.succeed(
    JobManagerService,
    JobManagerService.make(makeJobManagerEffect(manager)),
  );
}

/**
 * Construct the {@link JobEffect} ops record for a given legacy job.
 * Exported alongside the layer factory for callers that already hold the
 * legacy instance and want to bridge inline.
 */
export function makeJobEffect(job: JobLike): JobEffect {
  return {
    jobId: job.jobId,
    emitAccepted: liftSend(() => job.emitAccepted()),
    emitRunning: liftSend(() => job.emitRunning()),
    emitEventKind: (kind, body) =>
      liftSend(() => job.emitEventKind(kind, body)),
    emitResult: (result) => liftSend(() => job.emitResult(result)),
    emitErrorEnvelope: (payload) =>
      liftSend(() => job.emitErrorEnvelope(payload)),
    transition: (next) => transitionEffect(job, next),
    markHeartbeat: Effect.sync(() => {
      job.markHeartbeat();
    }),
    cancel: (reason) =>
      Effect.sync(() => {
        job.cancel(reason);
      }),
    abortHard: (reason) =>
      Effect.sync(() => {
        job.abortHard(reason);
      }),
    state: Effect.sync(() => job.state),
    isTerminal: Effect.sync(() => job.isTerminal),
  };
}

/** Construct the {@link JobManagerEffect} ops record for a given legacy manager. */
export function makeJobManagerEffect(
  manager: JobManagerLike,
): JobManagerEffect {
  return {
    register: (job) =>
      Effect.sync(() => {
        manager.register(job);
      }),
    get: (jobId) => Effect.sync(() => manager.get(jobId)),
    has: (jobId) => Effect.sync(() => manager.has(jobId)),
    retire: (jobId) =>
      Effect.sync(() => {
        manager.retire(jobId);
      }),
    list: Effect.sync(() => manager.list()),
    cancelAll: (reason) => Effect.sync(() => manager.cancelAll(reason)),
    abortAll: (reason) =>
      Effect.sync(() => {
        manager.abortAll(reason);
      }),
  };
}

/**
 * Build a fiber-safe heartbeat watchdog. The returned record carries:
 *
 *   - `reset`: an `Effect<void>` that re-arms the deadline to `now + thresholdMs`.
 *     Call this whenever an event suggests the peer is still alive.
 *   - `await`: an `Effect<never, TaggedHeartbeatLost>` that polls the deadline
 *     on a `Schedule.fixed("250 millis")` cadence; it fails the moment
 *     `now >= deadline`. Fork this onto a daemon fiber and `Effect.race` the
 *     job's workflow against it for the §6.4 "heartbeat lost" failure
 *     pattern called out in #44.
 *
 * No transport coupling — this is the Effect-shape twin of the legacy
 * `Job`-owned `setTimeout` watchdog, intended for new Effect-graph callers
 * that want typed-error semantics. The legacy watchdog stays in place for
 * the existing `Job` class consumers.
 *
 * @param thresholdMs grace period (ms) between resets before
 *   {@link TaggedHeartbeatLost} fires
 * @param label optional context tag included in the failure message
 */
export function watchdogEffect(
  thresholdMs: number,
  label?: string,
): Effect.Effect<{
  readonly reset: Effect.Effect<void>;
  readonly await: Effect.Effect<never, TaggedHeartbeatLost>;
}> {
  return Effect.gen(function* () {
    const deadline = yield* Ref.make(Date.now() + thresholdMs);
    const reset = Ref.set(deadline, Date.now() + thresholdMs);
    const await_ = watchdogPoll(deadline, label);
    return { reset, await: await_ };
  });
}

function watchdogPoll(
  deadline: Ref.Ref<number>,
  label: string | undefined,
): Effect.Effect<never, TaggedHeartbeatLost> {
  const tick = Effect.gen(function* () {
    const d = yield* Ref.get(deadline);
    if (Date.now() >= d) {
      yield* Effect.fail(
        new TaggedHeartbeatLost({
          message:
            label === undefined
              ? "watchdog: heartbeat threshold exceeded"
              : `watchdog: heartbeat threshold exceeded (${label})`,
        }),
      );
    }
  });
  // Repeat forever on a 250 ms cadence; the typed failure short-circuits
  // the loop on the first missed deadline. Cast to `never` since the
  // success branch is unreachable.
  return tick.pipe(
    Effect.repeat(Schedule.fixed("250 millis")),
  ) as Effect.Effect<never, TaggedHeartbeatLost>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function liftSend(
  thunk: () => Promise<void>,
): Effect.Effect<void, TaggedSdkError> {
  return Effect.tryPromise({
    try: thunk,
    catch: (cause) => liftToTagged(cause),
  });
}

function transitionEffect(
  job: JobLike,
  next: JobStateName,
): Effect.Effect<void, TaggedInvalidRequest> {
  return Effect.try({
    try: () => {
      job.transition(next);
    },
    catch: (cause) => liftToTagged(cause) as TaggedInvalidRequest,
  });
}

function liftToTagged(cause: unknown): TaggedSdkError {
  if (cause instanceof ARCPErrorClass) return taggedFromARCP(cause);
  throw cause as Error;
}

function unboundJobStub(): JobEffect {
  const die = (): Effect.Effect<never> =>
    Effect.die("JobService not bound; provide jobLayer");
  return {
    jobId: "",
    emitAccepted: die(),
    emitRunning: die(),
    emitEventKind: () => die(),
    emitResult: () => die(),
    emitErrorEnvelope: () => die(),
    transition: () => die(),
    markHeartbeat: die(),
    cancel: () => die(),
    abortHard: () => die(),
    state: die(),
    isTerminal: die(),
  };
}

function unboundJobManagerStub(): JobManagerEffect {
  const die = (): Effect.Effect<never> =>
    Effect.die("JobManagerService not bound; provide jobManagerLayer");
  return {
    register: () => die(),
    get: () => die(),
    has: () => die(),
    retire: () => die(),
    list: die(),
    cancelAll: () => die(),
    abortAll: () => die(),
  };
}
