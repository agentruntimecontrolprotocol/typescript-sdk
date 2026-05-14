import type { BaseEnvelope } from "@arcp/core/envelope";
import { buildEnvelope } from "@arcp/core/envelope";
import {
  type ARCPError,
  CancelledError,
  HeartbeatLostError,
  InternalError,
  InvalidRequestError,
  TimeoutError,
} from "@arcp/core/errors";
import type { Logger } from "@arcp/core/logger";
import type {
  ArtifactRefBody,
  DelegateBody,
  JobErrorPayload,
  JobResultPayload,
  JobStateName,
  Lease,
  LogPayload,
  MetricPayload,
  StatusBody,
  ThoughtBody,
  ToolCallBody,
  ToolResultBody,
} from "@arcp/core/messages";
import { newJobId, newMessageId, nowTimestamp } from "@arcp/core/util";

// ARCP v1.0 §7-§8 job execution.
//
// State machine: pending → running → {success | error | cancelled | timed_out}.
// All event-bearing envelopes (job.event / job.result / job.error) carry a
// session-scoped `event_seq` stamped by the SessionContext at emit time.

const JOB_TRANSITIONS: Record<JobStateName, ReadonlySet<JobStateName>> = {
  pending: new Set<JobStateName>([
    "running",
    "cancelled",
    "error",
    "timed_out",
  ]),
  running: new Set<JobStateName>([
    "success",
    "error",
    "cancelled",
    "timed_out",
  ]),
  success: new Set<JobStateName>([]),
  error: new Set<JobStateName>([]),
  cancelled: new Set<JobStateName>([]),
  timed_out: new Set<JobStateName>([]),
};

const TERMINAL: ReadonlySet<JobStateName> = new Set<JobStateName>([
  "success",
  "error",
  "cancelled",
  "timed_out",
]);

/** Sequence-number provider (§8.3), implemented by {@link SessionContext}. */
export interface EventSeqSource {
  /** Increment and return the next session-scoped event_seq. */
  nextEventSeq(): number;
}

/** Send hook the Job uses to flush an outbound envelope. */
export type JobSend = (env: BaseEnvelope) => Promise<void>;

/** Constructor options for {@link Job}. */
export interface JobOptions {
  /** Pre-assigned `job_id` (used on idempotency hits to reuse an existing id). */
  jobId?: string;
  /** Owning session id. Stamped on every outbound envelope. */
  sessionId: string;
  /** Agent name handling the job. */
  agent: string;
  /** Immutable effective lease (§9.1) — already a subset of the request. */
  lease: Lease;
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
 * Per-job state machine (§7.3 / §8).
 *
 * Owns the job's lifecycle, the abort signal exposed to the agent, the
 * heartbeat watchdog, and the emission of `job.accepted` /
 * `job.event` / `job.result` / `job.error` envelopes. The session
 * provides the monotonic `event_seq` source.
 */
export class Job {
  public readonly jobId: string;
  public readonly sessionId: string;
  public readonly agent: string;
  public readonly lease: Lease;
  public readonly parentJobId: string | undefined;
  public readonly delegateId: string | undefined;
  public readonly traceId: string | undefined;
  public state: JobStateName = "pending";
  public readonly abortController = new AbortController();

  private missedHeartbeats = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly missesAllowed: number;
  private readonly heartbeatIntervalMs: number;

  public constructor(
    options: JobOptions,
    private readonly send: JobSend,
    private readonly seq: EventSeqSource,
    public readonly logger: Logger,
  ) {
    this.jobId = options.jobId ?? newJobId();
    this.sessionId = options.sessionId;
    this.agent = options.agent;
    this.lease = options.lease;
    this.parentJobId = options.parentJobId;
    this.delegateId = options.delegateId;
    this.traceId = options.traceId;
    this.heartbeatIntervalMs = options.heartbeatIntervalSeconds * 1000;
    this.missesAllowed = options.missedHeartbeatsAllowed ?? 2;
  }

  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  public get isTerminal(): boolean {
    return TERMINAL.has(this.state);
  }

  public transition(next: JobStateName): void {
    if (this.state === next) return;
    const allowed = JOB_TRANSITIONS[this.state];
    if (!allowed.has(next)) {
      throw new InvalidRequestError(
        `Illegal job transition: ${this.state} → ${next}`,
        {
          details: { from: this.state, to: next, jobId: this.jobId },
        },
      );
    }
    this.state = next;
  }

  public startWatchdog(): void {
    this.armWatchdog();
  }

  public markHeartbeat(): void {
    this.missedHeartbeats = 0;
    this.armWatchdog();
  }

  /** Cooperatively cancel the job; armed timer will follow per §7.4. */
  public cancel(reason: string): void {
    if (this.isTerminal) return;
    this.abortController.abort(new CancelledError(reason));
  }

  /** Force-fail the job after a hard kill / grace expiry. */
  public abortHard(reason: string): void {
    if (this.isTerminal) return;
    const err = new InternalError(reason);
    this.abortController.abort(err);
    this.disarmWatchdog();
    this.transition("error");
    void this.emitErrorEnvelope({
      final_status: "error",
      code: "INTERNAL_ERROR",
      message: reason,
      retryable: true,
    });
  }

  // -------- Outbound envelopes ---------------------------------------

  /** Emit `job.accepted`. Does NOT carry `event_seq`. */
  public async emitAccepted(): Promise<void> {
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.accepted" as const,
      payload: {
        job_id: this.jobId,
        lease: this.lease,
        accepted_at: nowTimestamp(),
        ...(this.parentJobId !== undefined
          ? { parent_job_id: this.parentJobId }
          : {}),
        ...(this.delegateId !== undefined
          ? { delegate_id: this.delegateId }
          : {}),
        ...(this.traceId !== undefined ? { trace_id: this.traceId } : {}),
      },
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        ...(this.traceId !== undefined ? { trace_id: this.traceId } : {}),
      },
    });
    await this.send(env);
  }

  /** Mark transition pending → running and emit a `status` event. */
  public async emitRunning(): Promise<void> {
    this.transition("running");
    await this.emitEventKind("status", { phase: "running" });
    this.startWatchdog();
  }

  /**
   * Emit a `job.event` with a specific kind and body. Stamps `event_seq`.
   */
  public async emitEventKind(kind: string, body: unknown): Promise<void> {
    if (this.isTerminal) return;
    this.markHeartbeat();
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.event" as const,
      payload: { kind, ts: nowTimestamp(), body },
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        event_seq: this.seq.nextEventSeq(),
        ...(this.traceId !== undefined ? { trace_id: this.traceId } : {}),
      },
    });
    await this.send(env);
  }

  /** Emit `job.result` (success terminal). Stamps `event_seq`. */
  public async emitResult(result: JobResultPayload): Promise<void> {
    if (this.isTerminal) return;
    this.transition("success");
    this.disarmWatchdog();
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.result" as const,
      payload: result,
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        event_seq: this.seq.nextEventSeq(),
        ...(this.traceId !== undefined ? { trace_id: this.traceId } : {}),
      },
    });
    await this.send(env);
  }

  /** Emit `job.error` (error / cancelled / timed_out terminal). */
  public async emitErrorEnvelope(payload: JobErrorPayload): Promise<void> {
    if (this.isTerminal) return;
    this.disarmWatchdog();
    const target: JobStateName = payload.final_status;
    this.transition(target);
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.error" as const,
      payload,
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        event_seq: this.seq.nextEventSeq(),
        ...(this.traceId !== undefined ? { trace_id: this.traceId } : {}),
      },
    });
    try {
      await this.send(env);
    } catch (err) {
      this.logger.error(
        { err, jobId: this.jobId },
        "failed to emit job.error envelope",
      );
    }
  }

  // -------- Watchdog ----------------------------------------------

  private armWatchdog(): void {
    this.disarmWatchdog();
    if (this.isTerminal) return;
    this.heartbeatTimer = setTimeout(
      () => this.onWatchdogFire(),
      this.heartbeatIntervalMs,
    );
    this.heartbeatTimer.unref();
  }

  private disarmWatchdog(): void {
    if (this.heartbeatTimer !== null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private onWatchdogFire(): void {
    if (this.isTerminal) return;
    this.missedHeartbeats += 1;
    if (this.missedHeartbeats >= this.missesAllowed) {
      const err = new HeartbeatLostError(
        `Job ${this.jobId} failed: ${this.missedHeartbeats} consecutive missed heartbeats`,
      );
      this.abortController.abort(err);
      void this.emitErrorEnvelope({
        final_status: "error",
        code: "HEARTBEAT_LOST",
        message: err.message,
        retryable: false,
      });
      return;
    }
    this.armWatchdog();
  }
}

/**
 * Tracks all live jobs for a session. Owned by {@link SessionContext}.
 */
export class JobManager {
  private readonly jobs = new Map<string, Job>();

  public register(job: Job): void {
    this.jobs.set(job.jobId, job);
  }

  public get(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  public has(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  public retire(jobId: string): void {
    this.jobs.delete(jobId);
  }

  public list(): readonly Job[] {
    return [...this.jobs.values()];
  }

  /** Cancel every active job. Returns the count of jobs that were cancelled. */
  public cancelAll(reason: string): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (!job.isTerminal) {
        job.cancel(reason);
        count += 1;
      }
    }
    return count;
  }

  /** Reject every still-running handler with INTERNAL during shutdown. */
  public abortAll(reason: string): void {
    for (const job of this.jobs.values()) {
      if (!job.isTerminal) {
        job.abortHard(reason);
      }
    }
  }
}

/**
 * Context surfaced to agent handlers (§7 / §8).
 *
 * Exposes one method per reserved {@link RESERVED_EVENT_KINDS} kind
 * (§8.2), plus {@link JobContext.emitEvent} for `x-vendor.*` kinds.
 * All emit methods stamp the session-scoped `event_seq` automatically.
 */
export interface JobContext {
  /** Server-assigned job id. */
  readonly jobId: string;
  /** Owning session id. */
  readonly sessionId: string;
  /** Agent name handling this job. */
  readonly agent: string;
  /** Immutable effective lease (§9.1). */
  readonly lease: Lease;
  /** W3C trace id (§11). */
  readonly traceId: string | undefined;
  /** Abort signal — fires on `job.cancel` or grace-expired termination. */
  readonly signal: AbortSignal;
  /** Job-scoped logger pre-bound to `job_id`. */
  readonly logger: Logger;

  /** Emit a `log` job event (§8.2 `log`). */
  log(
    level: LogPayload["level"],
    message: string,
    attributes?: Record<string, unknown>,
  ): Promise<void>;
  /** Emit a `thought` job event (§8.2 `thought`). */
  thought(text: string): Promise<void>;
  /** Emit a `status` job event (§8.2 `status`). */
  status(phase: string, message?: string): Promise<void>;
  /** Emit a `metric` job event (§8.2 `metric`). */
  metric(metric: MetricPayload): Promise<void>;
  /** Emit a `tool_call` job event (§8.2 `tool_call`). */
  toolCall(body: ToolCallBody): Promise<void>;
  /** Emit a `tool_result` job event (§8.2 `tool_result`). */
  toolResult(body: ToolResultBody): Promise<void>;
  /** Emit an `artifact_ref` job event (§8.2 `artifact_ref`). */
  artifactRef(body: ArtifactRefBody): Promise<void>;
  /** Emit a `delegate` job event (§10). Runtime intercepts and spawns the child. */
  delegate(body: DelegateBody): Promise<void>;

  /** Emit any other event kind (including `x-vendor.*`) with a raw body. */
  emitEvent(kind: string, body: unknown): Promise<void>;
}

/** Build a {@link JobContext} backed by a {@link Job}. */
export function makeJobContext(job: Job): JobContext {
  return {
    jobId: job.jobId,
    sessionId: job.sessionId,
    agent: job.agent,
    lease: job.lease,
    traceId: job.traceId,
    signal: job.signal,
    logger: job.logger,
    async log(level, message, attributes) {
      await job.emitEventKind("log", {
        level,
        message,
        ...(attributes !== undefined ? { attributes } : {}),
      } satisfies LogPayload);
    },
    async thought(text) {
      await job.emitEventKind("thought", { text } satisfies ThoughtBody);
    },
    async status(phase, message) {
      const body: StatusBody = {
        phase,
        ...(message !== undefined ? { message } : {}),
      };
      await job.emitEventKind("status", body);
    },
    async metric(metric) {
      await job.emitEventKind("metric", metric);
    },
    async toolCall(body) {
      await job.emitEventKind("tool_call", body);
    },
    async toolResult(body) {
      await job.emitEventKind("tool_result", body);
    },
    async artifactRef(body) {
      await job.emitEventKind("artifact_ref", body);
    },
    async delegate(body) {
      await job.emitEventKind("delegate", body);
    },
    async emitEvent(kind, body) {
      await job.emitEventKind(kind, body);
    },
  };
}

/**
 * The handler signature for agents registered with the runtime. Agents
 * receive `input` and a {@link JobContext}; they return the result value
 * or throw an {@link ARCPError} to signal failure.
 */
export type AgentHandler<Input = unknown, Result = unknown> = (
  input: Input,
  ctx: JobContext,
) => Promise<Result>;

// Re-export commonly used error types so consumers can import in one place.
export { CancelledError, HeartbeatLostError, InternalError, TimeoutError };
