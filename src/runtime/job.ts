import type { BaseEnvelope } from "../envelope.js";
import { buildEnvelope } from "../envelope.js";
import {
  AbortedError,
  type ARCPError,
  CancelledError,
  FailedPreconditionError,
  HeartbeatLostError,
  InternalError,
} from "../errors.js";
import type { Logger } from "../logger.js";
import type {
  JobCancelledPayload,
  JobProgressPayload,
  JobStateName,
  LogPayload,
  MetricPayload,
  StreamKind,
} from "../messages/index.js";
import { newJobId, newMessageId, nowTimestamp } from "../util/ulid.js";
import { StreamWriter } from "./stream.js";

const JOB_TRANSITIONS: Record<JobStateName, ReadonlySet<JobStateName>> = {
  accepted: new Set<JobStateName>(["queued", "running", "cancelled", "failed"]),
  queued: new Set<JobStateName>(["running", "cancelled", "failed"]),
  running: new Set<JobStateName>(["blocked", "paused", "completed", "failed", "cancelled"]),
  blocked: new Set<JobStateName>(["running", "cancelled", "failed"]),
  paused: new Set<JobStateName>(["running", "cancelled", "failed"]),
  completed: new Set<JobStateName>([]),
  failed: new Set<JobStateName>([]),
  cancelled: new Set<JobStateName>([]),
};

const TERMINAL: ReadonlySet<JobStateName> = new Set<JobStateName>([
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Per-job state machine and watchdog (§10.2, §10.3).
 *
 * A {@link Job} tracks state, drives the heartbeat watchdog, and exposes
 * helpers the user-supplied tool handler uses to emit progress, logs, and
 * heartbeats. The handler runs in the {@link run} method.
 */
export class Job {
  public readonly jobId: string;
  /** Id of the originating `tool.invoke` envelope (for `correlation_id`). */
  public readonly originId: string;
  public readonly sessionId: string;
  public state: JobStateName = "accepted";
  public readonly abortController = new AbortController();
  public createdAt = nowTimestamp();

  /**
   * Number of consecutive missed heartbeat deadlines. Reset on each
   * `markHeartbeat()` (or progress) call.
   */
  private missedHeartbeats = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly missesAllowed: number;
  private readonly heartbeatIntervalMs: number;
  private heartbeatSequence = 0;

  public constructor(
    options: {
      jobId?: string;
      originId: string;
      sessionId: string;
      heartbeatIntervalSeconds: number;
      missedHeartbeatsAllowed?: number;
    },
    private readonly send: (env: BaseEnvelope) => Promise<void>,
    public readonly logger: Logger,
  ) {
    this.jobId = options.jobId ?? newJobId();
    this.originId = options.originId;
    this.sessionId = options.sessionId;
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
      throw new FailedPreconditionError(`Illegal job transition: ${this.state} → ${next}`, {
        details: { from: this.state, to: next, jobId: this.jobId },
      });
    }
    this.state = next;
  }

  /**
   * Start the heartbeat watchdog. Called when the job transitions to running.
   * Two consecutive timer fires without {@link markHeartbeat} ⇒ HEARTBEAT_LOST.
   */
  public startWatchdog(): void {
    this.armWatchdog();
  }

  /** Reset the missed-heartbeat counter and re-arm the timer. */
  public markHeartbeat(): void {
    this.missedHeartbeats = 0;
    this.armWatchdog();
  }

  /** Cooperatively cancel the job. Caller may force-kill via abort signal. */
  public cancel(reason: string, source: JobCancelledPayload["source"]): void {
    this.abortController.abort(new CancelledError(reason));
    this.disarmWatchdog();
    if (!this.isTerminal) {
      this.transition("cancelled");
      void this.emitTerminalEnvelope("job.cancelled", {
        reason,
        ...(source !== undefined ? { source } : {}),
      });
    }
  }

  /** Force-fail the job with a specific error (used by hard-kill escalation). */
  public abortHard(reason: string): void {
    this.abortController.abort(new AbortedError(reason));
    this.disarmWatchdog();
    if (!this.isTerminal) {
      this.transition("failed");
      void this.emitTerminalEnvelope("job.failed", new AbortedError(reason).toPayload());
    }
  }

  /** Move the job to `blocked`, e.g. while awaiting human input. */
  public block(): void {
    if (this.state === "running") this.transition("blocked");
  }

  /** Move the job back to `running` from `blocked`. */
  public unblock(): void {
    if (this.state === "blocked") this.transition("running");
  }

  // -------- Outbound helpers ---------------------------------------

  public async emitAccepted(): Promise<void> {
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.accepted" as const,
      timestamp: nowTimestamp(),
      payload: { job_id: this.jobId, accepted_at: nowTimestamp() },
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        correlation_id: this.originId,
      },
    });
    await this.send(env as BaseEnvelope);
  }

  public async emitStarted(): Promise<void> {
    this.transition("running");
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.started" as const,
      timestamp: nowTimestamp(),
      payload: { job_id: this.jobId, started_at: nowTimestamp() },
      optional: { session_id: this.sessionId, job_id: this.jobId },
    });
    await this.send(env as BaseEnvelope);
    this.startWatchdog();
  }

  public async emitProgress(progress: JobProgressPayload): Promise<void> {
    this.markHeartbeat();
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.progress" as const,
      timestamp: nowTimestamp(),
      payload: progress,
      optional: { session_id: this.sessionId, job_id: this.jobId },
    });
    await this.send(env as BaseEnvelope);
  }

  public async emitHeartbeat(): Promise<void> {
    this.markHeartbeat();
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.heartbeat" as const,
      timestamp: nowTimestamp(),
      payload: {
        sequence: this.heartbeatSequence,
        deadline_ms: this.heartbeatIntervalMs,
        state: this.state,
      },
      optional: { session_id: this.sessionId, job_id: this.jobId },
    });
    this.heartbeatSequence += 1;
    await this.send(env as BaseEnvelope);
  }

  public async emitLog(log: LogPayload): Promise<void> {
    const env = buildEnvelope({
      id: newMessageId(),
      type: "log" as const,
      timestamp: nowTimestamp(),
      payload: log,
      optional: { session_id: this.sessionId, job_id: this.jobId },
    });
    await this.send(env as BaseEnvelope);
  }

  public async emitMetric(metric: MetricPayload): Promise<void> {
    const env = buildEnvelope({
      id: newMessageId(),
      type: "metric" as const,
      timestamp: nowTimestamp(),
      payload: metric,
      optional: { session_id: this.sessionId, job_id: this.jobId },
    });
    await this.send(env as BaseEnvelope);
  }

  public async emitToolResult(value: unknown): Promise<void> {
    if (!this.isTerminal) this.transition("completed");
    this.disarmWatchdog();
    const env = buildEnvelope({
      id: newMessageId(),
      type: "tool.result" as const,
      timestamp: nowTimestamp(),
      payload: value === undefined ? {} : { value },
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        correlation_id: this.originId,
      },
    });
    await this.send(env as BaseEnvelope);
  }

  public async emitToolError(err: ARCPError): Promise<void> {
    if (!this.isTerminal) this.transition("failed");
    this.disarmWatchdog();
    const env = buildEnvelope({
      id: newMessageId(),
      type: "tool.error" as const,
      timestamp: nowTimestamp(),
      payload: err.toPayload(),
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        correlation_id: this.originId,
      },
    });
    await this.send(env as BaseEnvelope);
  }

  /** Open a new outbound stream associated with this job. */
  public openStream(options: {
    kind: StreamKind;
    contentType?: string;
    encoding?: string;
  }): StreamWriter {
    return new StreamWriter(this.sessionId, this.send, {
      ...options,
      relatedJobId: this.jobId,
    });
  }

  // -------- Internals ----------------------------------------------

  private armWatchdog(): void {
    this.disarmWatchdog();
    if (this.isTerminal) return;
    this.heartbeatTimer = setTimeout(() => this.onWatchdogFire(), this.heartbeatIntervalMs);
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
      this.failHeartbeatLost();
      return;
    }
    this.armWatchdog();
  }

  private failHeartbeatLost(): void {
    if (this.isTerminal) return;
    const err = new HeartbeatLostError(
      `Job ${this.jobId} failed: ${this.missedHeartbeats} consecutive missed heartbeats`,
    );
    this.abortController.abort(err);
    this.transition("failed");
    void this.emitTerminalEnvelope("job.failed", err.toPayload());
  }

  private async emitTerminalEnvelope(
    type: "job.completed" | "job.failed" | "job.cancelled",
    payload: unknown,
  ): Promise<void> {
    try {
      const env = buildEnvelope({
        id: newMessageId(),
        type,
        timestamp: nowTimestamp(),
        payload,
        optional: { session_id: this.sessionId, job_id: this.jobId },
      });
      await this.send(env as BaseEnvelope);
    } catch (err) {
      this.logger.error({ err, type, jobId: this.jobId }, "failed to emit terminal envelope");
    }
  }
}

/**
 * Tracks all live jobs for a session. Provides cancellation lookup and
 * graceful shutdown.
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
        job.cancel(reason, "runtime");
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
 * The handler signature for tools registered with the runtime. Tools receive
 * arguments and a {@link JobContext}; they return the result value or throw
 * an {@link ARCPError} to signal failure.
 */
export interface JobContext {
  readonly jobId: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly logger: Logger;
  emitProgress(progress: JobProgressPayload): Promise<void>;
  emitHeartbeat(): Promise<void>;
  log(
    level: LogPayload["level"],
    message: string,
    attributes?: Record<string, unknown>,
  ): Promise<void>;
  metric(metric: MetricPayload): Promise<void>;
  openStream(options: { kind: StreamKind; contentType?: string; encoding?: string }): StreamWriter;
}

export type ToolHandler<Args = Record<string, unknown>, Result = unknown> = (
  args: Args,
  ctx: JobContext,
) => Promise<Result>;

/** Build a {@link JobContext} backed by a {@link Job}. */
export function makeJobContext(job: Job): JobContext {
  return {
    jobId: job.jobId,
    sessionId: job.sessionId,
    signal: job.signal,
    logger: job.logger,
    emitProgress: (p) => job.emitProgress(p),
    emitHeartbeat: () => job.emitHeartbeat(),
    log: async (level, message, attributes) => {
      await job.emitLog({
        level,
        message,
        ...(attributes !== undefined ? { attributes } : {}),
      });
    },
    metric: (m) => job.emitMetric(m),
    openStream: (opts) => job.openStream(opts),
  };
}

// Re-export so `runtime/index.ts` consumers can import in one place.
export { AbortedError, CancelledError, HeartbeatLostError, InternalError };
