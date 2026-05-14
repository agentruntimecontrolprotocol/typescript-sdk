import type { BearerVerifier } from "@arcp/core/auth";
import type { BaseEnvelope } from "@arcp/core/envelope";
import type { Logger } from "@arcp/core/logger";
import type {
  ArtifactRefBody,
  Capabilities,
  DelegateBody,
  Envelope,
  Lease,
  LeaseConstraints,
  LogPayload,
  MetricPayload,
  ResultChunkBody,
  RuntimeIdentity,
  ToolCallBody,
  ToolResultBody,
} from "@arcp/core/messages";
import type { EventLog } from "@arcp/core/store";

import type { Job } from "./job.js";
import type { SessionContext } from "./server.js";

// ---- handler ---------------------------------------------------------------

/** Inbound-message dispatcher signature. */
export type Handler = (
  env: Envelope,
  ctx: SessionContext,
) => Promise<void> | void;

// ---- job -------------------------------------------------------------------

/** Sequence-number provider (§8.3), implemented by `SessionContext`. */
export interface EventSeqSource {
  /** Increment and return the next session-scoped event_seq. */
  nextEventSeq(): number;
}

/** Send hook the Job uses to flush an outbound envelope. */
export type JobSend = (env: BaseEnvelope) => Promise<void>;

/** Constructor options for `Job`. */
export interface JobOptions {
  /** Pre-assigned `job_id` (used on idempotency hits to reuse an existing id). */
  jobId?: string;
  /** Owning session id. Stamped on every outbound envelope. */
  sessionId: string;
  /** Agent name handling the job. */
  agent: string;
  /** v1.1 §7.5 — resolved agent version. May be null when no version is registered. */
  agentVersion?: string | null;
  /** Immutable effective lease (§9.1) — already a subset of the request. */
  lease: Lease;
  /** v1.1 §9.5 — lease constraints (currently `expires_at`). */
  leaseConstraints?: LeaseConstraints | undefined;
  /** v1.1 §9.6 — initial per-currency budget counters. */
  initialBudget?: ReadonlyMap<string, number> | undefined;
  /** Parent job id when this is a delegated child (§10). */
  parentJobId?: string;
  /** Delegate id assigned by the parent in its `delegate` event (§10). */
  delegateId?: string;
  /** W3C trace id propagated for OTel correlation (§11). */
  traceId?: string;
  /** Heartbeat watchdog interval. */
  heartbeatIntervalSeconds: number;
  /** Heartbeats missed before HEARTBEAT_LOST. Default 2. */
  missedHeartbeatsAllowed?: number;
}

/**
 * v1.1 streamed-result writer (§8.4). Push chunks with `write`; call
 * `finalize` to emit the terminating `job.result` payload. The runtime
 * generates `result_id`/`chunk_seq` automatically.
 */
export interface ResultStream {
  /** Stable identifier for the assembled result. */
  readonly resultId: string;
  /** Push one chunk. `more: false` is set by `finalize`. */
  write(data: string, opts?: { encoding?: "utf8" | "base64" }): Promise<void>;
  /**
   * Emit the final chunk (if `data` is provided) and the terminating
   * `job.result` carrying `result_id`. Returns the assembled byte count.
   */
  finalize(
    data?: string,
    opts?: {
      encoding?: "utf8" | "base64";
      summary?: string;
      resultSize?: number;
    },
  ): Promise<void>;
}

/**
 * Context surfaced to agent handlers (§7 / §8).
 *
 * Exposes one method per reserved event kind (§8.2), plus `emitEvent` for
 * `x-vendor.*` kinds. All emit methods stamp the session-scoped `event_seq`
 * automatically.
 */
export interface JobContext {
  /** Server-assigned job id. */
  readonly jobId: string;
  /** Owning session id. */
  readonly sessionId: string;
  /** Agent name handling this job (bare name). */
  readonly agent: string;
  /** v1.1 §7.5 — resolved agent version, or null when unversioned. */
  readonly agentVersion: string | null;
  /** Wire-form agent reference (`name@version` or bare `name`). */
  readonly agentRef: string;
  /** Immutable effective lease (§9.1). */
  readonly lease: Lease;
  /** v1.1 §9.5 — lease constraints (currently `expires_at`). */
  readonly leaseConstraints: LeaseConstraints | undefined;
  /**
   * v1.1 §9.6 — read-only snapshot of remaining per-currency budget. Re-read
   * after `cost.*` metrics fire to observe decrements.
   */
  readonly budget: ReadonlyMap<string, number>;
  /** W3C trace id (§11). */
  readonly traceId: string | undefined;
  /** Abort signal — fires on `job.cancel` or grace-expired termination. */
  readonly signal: AbortSignal;
  /** Job-scoped logger pre-bound to `job_id`. */
  readonly logger: Logger;

  log(
    level: LogPayload["level"],
    message: string,
    attributes?: Record<string, unknown>,
  ): Promise<void>;
  thought(text: string): Promise<void>;
  status(phase: string, message?: string): Promise<void>;
  metric(metric: MetricPayload): Promise<void>;
  toolCall(body: ToolCallBody): Promise<void>;
  toolResult(body: ToolResultBody): Promise<void>;
  artifactRef(body: ArtifactRefBody): Promise<void>;
  delegate(body: DelegateBody): Promise<void>;
  progress(
    current: number,
    opts?: { total?: number; units?: string; message?: string },
  ): Promise<void>;
  resultChunk(body: ResultChunkBody): Promise<void>;
  streamResult(opts?: { resultId?: string }): ResultStream;
  emitEvent(kind: string, body: unknown): Promise<void>;
}

/**
 * The handler signature for agents registered with the runtime. Agents
 * receive `input` and a `JobContext`; they return the result value or throw
 * an `ARCPError` to signal failure.
 */
export type AgentHandler<Input = unknown, Result = unknown> = (
  input: Input,
  ctx: JobContext,
) => Promise<Result>;

export type {
  ArtifactRefBody,
  DelegateBody,
  Lease,
  LeaseConstraints,
  LogPayload,
  MetricPayload,
  ProgressBody,
  ResultChunkBody,
  StatusBody,
  ThoughtBody,
  ToolCallBody,
  ToolResultBody,
} from "@arcp/core/messages";

// ---- lease -----------------------------------------------------------------

/**
 * Optional extra context surfaced to `validateLeaseOp` for v1.1 enforcement:
 * lease expiration and per-currency budget counters.
 *
 * Both `constraints` and `budgetRemaining` are evaluated before the
 * glob/pattern check.
 */
export interface LeaseOpContext {
  constraints?: LeaseConstraints | undefined;
  budgetRemaining?: ReadonlyMap<string, number> | undefined;
  /** Clock override for tests; defaults to `Date.now()`. */
  now?: number;
}

// ---- server ----------------------------------------------------------------

/**
 * v1.1 §6.6 — authorization hook for `session.list_jobs` and
 * `job.subscribe`. Returns true if `principal` may observe `job`.
 */
export type JobAuthorizationPolicy = (
  job: Job,
  principal: string | undefined,
) => boolean;

/**
 * Per-session DoS / resource caps (§14).
 *
 * Defaults: 10_000 buffered events, 16 MiB buffered bytes, 100 concurrent
 * jobs. Exceeding any cap closes the session with `INTERNAL_ERROR`
 * (non-retryable).
 */
export interface SessionCaps {
  /** Max number of outbound envelopes buffered in the event log per session. */
  maxBufferedEvents?: number;
  /** Max number of outbound envelope bytes buffered per session. */
  maxBufferedBytes?: number;
  /** Max number of concurrent jobs in a single session. */
  maxConcurrentJobs?: number;
}

/** Top-level server options. */
export interface ARCPServerOptions {
  /** Identity broadcast in `session.welcome`. */
  runtime: RuntimeIdentity;
  /** Capabilities advertised by this runtime. */
  capabilities: Capabilities;
  /** Bearer-token verifier. Required in v1.0. */
  bearer?: BearerVerifier;
  /** Event log to persist envelopes. Defaults to an in-memory log. */
  eventLog?: EventLog;
  /** Logger. */
  logger?: Logger;
  /** Heartbeat watchdog interval. Default 30 s. */
  heartbeatIntervalSeconds?: number;
  /** Resume buffer window. Default 600 s. */
  resumeWindowSeconds?: number;
  /** Cancellation grace period before forced termination. Default 30_000 ms. */
  cancelGraceMs?: number;
  /** Idempotency cache TTL. Default 24 h. */
  idempotencyTtlMs?: number;
  /** Per-session DoS caps. */
  caps?: SessionCaps;
  /**
   * v1.1 §6.2 — feature flags this runtime advertises. Defaults to every
   * v1.1 feature.
   */
  features?: readonly string[];
  /**
   * v1.1 §6.6 — authorization hook for cross-session observation. Defaults
   * to same-principal-only.
   */
  jobAuthorizationPolicy?: JobAuthorizationPolicy;
  /**
   * v1.1 §6.5 — threshold (in unacked events) at which the runtime emits a
   * `back_pressure` status event. Default 1000.
   */
  backPressureThreshold?: number;
}
