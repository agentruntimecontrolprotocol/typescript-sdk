import type { BaseEnvelope } from "@arcp/core/envelope";
import { buildEnvelope } from "@arcp/core/envelope";
import {
  CancelledError,
  HeartbeatLostError,
  InternalError,
  InvalidRequestError,
} from "@arcp/core/errors";
import type { Logger } from "@arcp/core/logger";
import type {
  ArtifactRefBody,
  DelegateBody,
  JobErrorPayload,
  JobResultPayload,
  JobStateName,
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
  success: new Set<JobStateName>(),
  error: new Set<JobStateName>(),
  cancelled: new Set<JobStateName>(),
  timed_out: new Set<JobStateName>(),
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
  /** v1.1 §7.5 — resolved version, or null if none was advertised. */
  public readonly agentVersion: string | null;
  public readonly lease: Lease;
  public readonly leaseConstraints: LeaseConstraints | undefined;
  /** v1.1 §9.6 — mutable per-currency budget counters. */
  public readonly budget: Map<string, number>;
  /** v1.1 §9.6 — initial budget for inclusion in `job.accepted`. */
  public readonly initialBudget: Map<string, number>;
  public readonly parentJobId: string | undefined;
  public readonly delegateId: string | undefined;
  public readonly traceId: string | undefined;
  /** Timestamp at which the job was constructed (for §6.6 listing). */
  public readonly createdAt: string = nowTimestamp();
  /**
   * v1.1 §6.6 / §7.6 — the principal that submitted this job. Used to scope
   * cross-session observation (`session.list_jobs`, `job.subscribe`). Set by
   * the runtime on job creation.
   */
  public submitterPrincipal: string | undefined = undefined;
  /**
   * v1.1 §7.6 — the session that owns the job's event stream (i.e., the
   * submitter's session). Subscribers tap this session's event log for
   * history replay. Set by the runtime on job creation; typed as `unknown`
   * to avoid an import cycle, but in practice is a `SessionContext`.
   */
  public owningSession: { state: { id: string | undefined } } | undefined =
    undefined;
  public state: JobStateName = "pending";
  public readonly abortController = new AbortController();
  /** v1.1 §8.4 — set true after the first `result_chunk` event is emitted. */
  public chunkedResultStarted = false;
  /** Track last-emitted remaining per currency for chatty-emit debounce. */
  private readonly lastEmittedRemaining = new Map<string, number>();

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
    this.agentVersion = options.agentVersion ?? null;
    this.lease = options.lease;
    this.leaseConstraints = options.leaseConstraints;
    this.initialBudget = new Map(options.initialBudget);
    this.budget = new Map(options.initialBudget);
    this.parentJobId = options.parentJobId;
    this.delegateId = options.delegateId;
    this.traceId = options.traceId;
    this.heartbeatIntervalMs = options.heartbeatIntervalSeconds * 1000;
    this.missesAllowed = options.missedHeartbeatsAllowed ?? 2;
  }

  /** Wire-form `agent` string: `name@version` if a version is set, else bare name. */
  public get agentRef(): string {
    return this.agentVersion === null
      ? this.agent
      : `${this.agent}@${this.agentVersion}`;
  }

  /**
   * v1.1 §9.6: decrement the matching budget counter from a `metric` event
   * whose name begins with `cost.` and whose unit matches a budgeted
   * currency. Returns the new remaining value, or `null` if no counter is
   * affected. Negative values are ignored.
   */
  public applyCostMetric(
    name: string,
    value: number,
    unit: string | undefined,
  ): number | null {
    if (!name.startsWith("cost.")) return null;
    if (name === "cost.budget.remaining") return null;
    if (unit === undefined) return null;
    if (!Number.isFinite(value) || value < 0) return null;
    const current = this.budget.get(unit);
    if (current === undefined) return null;
    const next = current - value;
    this.budget.set(unit, next);
    return next;
  }

  /**
   * Whether to emit a debounced `cost.budget.remaining` metric for `currency`.
   * Only emits when the remaining has changed by ≥5% of the initial budget
   * since the last emit (or on first emission).
   */
  public shouldEmitBudgetRemaining(currency: string): boolean {
    const remaining = this.budget.get(currency);
    if (remaining === undefined) return false;
    const initial = this.initialBudget.get(currency) ?? 0;
    const last = this.lastEmittedRemaining.get(currency);
    if (last === undefined) {
      this.lastEmittedRemaining.set(currency, remaining);
      return true;
    }
    const threshold = initial * 0.05;
    if (Math.abs(last - remaining) >= threshold || remaining <= 0) {
      this.lastEmittedRemaining.set(currency, remaining);
      return true;
    }
    return false;
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
    const budgetObj: Record<string, number> = {};
    let hasBudget = false;
    for (const [k, v] of this.initialBudget.entries()) {
      budgetObj[k] = v;
      hasBudget = true;
    }
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.accepted" as const,
      payload: {
        job_id: this.jobId,
        agent: this.agentRef,
        lease: this.lease,
        ...(this.leaseConstraints === undefined
          ? {}
          : { lease_constraints: this.leaseConstraints }),
        ...(hasBudget ? { budget: budgetObj } : {}),
        accepted_at: this.createdAt,
        ...(this.parentJobId === undefined
          ? {}
          : { parent_job_id: this.parentJobId }),
        ...(this.delegateId === undefined
          ? {}
          : { delegate_id: this.delegateId }),
        ...(this.traceId === undefined ? {} : { trace_id: this.traceId }),
      },
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        ...(this.traceId === undefined ? {} : { trace_id: this.traceId }),
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
   *
   * v1.1: tracks `chunkedResultStarted` when a `result_chunk` body is
   * emitted, so the terminal `job.result` enforcement can reject mixing
   * inline result with chunks (§8.4).
   */
  public async emitEventKind(kind: string, body: unknown): Promise<void> {
    if (this.isTerminal) return;
    this.markHeartbeat();
    if (kind === "result_chunk") this.chunkedResultStarted = true;
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.event" as const,
      payload: { kind, ts: nowTimestamp(), body },
      optional: {
        session_id: this.sessionId,
        job_id: this.jobId,
        event_seq: this.seq.nextEventSeq(),
        ...(this.traceId === undefined ? {} : { trace_id: this.traceId }),
      },
    });
    await this.send(env);
  }

  /**
   * Emit `job.result` (success terminal). Stamps `event_seq`.
   *
   * v1.1 §8.4: if `result_chunk` events have been emitted on this job, the
   * terminating `job.result` MUST carry `result_id` and MUST NOT carry an
   * inline `result` value.
   */
  public async emitResult(result: JobResultPayload): Promise<void> {
    if (this.isTerminal) return;
    if (this.chunkedResultStarted) {
      if (result.result_id === undefined) {
        throw new InvalidRequestError(
          "job.result MUST carry result_id when result_chunk events were emitted",
        );
      }
      if (result.result !== undefined) {
        throw new InvalidRequestError(
          "job.result MUST NOT carry inline `result` when result_chunk events were emitted",
        );
      }
    }
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
        ...(this.traceId === undefined ? {} : { trace_id: this.traceId }),
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
        ...(this.traceId === undefined ? {} : { trace_id: this.traceId }),
      },
    });
    try {
      await this.send(env);
    } catch (error) {
      this.logger.error(
        { err: error, jobId: this.jobId },
        "failed to emit job.error envelope",
      );
    }
  }

  // -------- Watchdog ----------------------------------------------

  private armWatchdog(): void {
    this.disarmWatchdog();
    if (this.isTerminal) return;
    this.heartbeatTimer = setTimeout(() => {
      this.onWatchdogFire();
    }, this.heartbeatIntervalMs);
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
/**
 * v1.1 streamed-result writer (§8.4). Push chunks with {@link write}; call
 * {@link finalize} to emit the terminating `job.result` payload. The runtime
 * generates `result_id`/`chunk_seq` automatically.
 */
export interface ResultStream {
  /** Stable identifier for the assembled result. */
  readonly resultId: string;
  /** Push one chunk. `more: false` is set by {@link finalize}. */
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

  /**
   * v1.1 §8.2.1: emit a `progress` event. Advisory — the protocol does not
   * act on progress events.
   */
  progress(
    current: number,
    opts?: { total?: number; units?: string; message?: string },
  ): Promise<void>;

  /**
   * v1.1 §8.4: emit a single `result_chunk` event. Prefer
   * {@link streamResult} which manages `result_id`/`chunk_seq` for you.
   */
  resultChunk(body: ResultChunkBody): Promise<void>;

  /**
   * v1.1 §8.4: open a chunked-result writer. The agent pushes chunks via
   * {@link ResultStream.write} and emits the terminal `job.result` via
   * {@link ResultStream.finalize}.
   */
  streamResult(opts?: { resultId?: string }): ResultStream;

  /** Emit any other event kind (including `x-vendor.*`) with a raw body. */
  emitEvent(kind: string, body: unknown): Promise<void>;
}

/** Build a {@link JobContext} backed by a {@link Job}. */
export function makeJobContext(job: Job): JobContext {
  return {
    jobId: job.jobId,
    sessionId: job.sessionId,
    agent: job.agent,
    agentVersion: job.agentVersion,
    agentRef: job.agentRef,
    lease: job.lease,
    leaseConstraints: job.leaseConstraints,
    budget: job.budget,
    traceId: job.traceId,
    signal: job.signal,
    logger: job.logger,
    async log(level, message, attributes) {
      await job.emitEventKind("log", {
        level,
        message,
        ...(attributes === undefined ? {} : { attributes }),
      } satisfies LogPayload);
    },
    async thought(text) {
      await job.emitEventKind("thought", { text } satisfies ThoughtBody);
    },
    async status(phase, message) {
      const body: StatusBody = {
        phase,
        ...(message === undefined ? {} : { message }),
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
    async progress(current, opts) {
      const body: ProgressBody = {
        current,
        ...(opts?.total === undefined ? {} : { total: opts.total }),
        ...(opts?.units === undefined ? {} : { units: opts.units }),
        ...(opts?.message === undefined ? {} : { message: opts.message }),
      };
      await job.emitEventKind("progress", body);
    },
    async resultChunk(body) {
      await job.emitEventKind("result_chunk", body);
    },
    streamResult(opts) {
      return makeResultStream(job, opts?.resultId);
    },
    async emitEvent(kind, body) {
      await job.emitEventKind(kind, body);
    },
  };
}

function makeResultStream(job: Job, resultIdIn?: string): ResultStream {
  const resultId = resultIdIn ?? `res_${newJobId().replace(/^job_/, "")}`;
  let chunkSeq = 0;
  let finalized = false;
  return {
    resultId,
    async write(data, opts) {
      if (finalized) {
        throw new InvalidRequestError(
          "ResultStream: cannot write after finalize",
        );
      }
      await job.emitEventKind("result_chunk", {
        result_id: resultId,
        chunk_seq: chunkSeq++,
        data,
        encoding: opts?.encoding ?? "utf8",
        more: true,
      } satisfies ResultChunkBody);
    },
    async finalize(data, opts) {
      if (finalized) {
        throw new InvalidRequestError("ResultStream: already finalized");
      }
      finalized = true;
      if (data !== undefined) {
        await job.emitEventKind("result_chunk", {
          result_id: resultId,
          chunk_seq: chunkSeq++,
          data,
          encoding: opts?.encoding ?? "utf8",
          more: false,
        } satisfies ResultChunkBody);
      } else if (chunkSeq > 0) {
        // Emit a terminal empty chunk to mark `more: false`.
        await job.emitEventKind("result_chunk", {
          result_id: resultId,
          chunk_seq: chunkSeq++,
          data: "",
          encoding: opts?.encoding ?? "utf8",
          more: false,
        } satisfies ResultChunkBody);
      }
      await job.emitResult({
        final_status: "success",
        result_id: resultId,
        ...(opts?.summary === undefined ? {} : { summary: opts.summary }),
        ...(opts?.resultSize === undefined
          ? {}
          : { result_size: opts.resultSize }),
      });
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

export {
  TimeoutError,
  CancelledError,
  HeartbeatLostError,
  InternalError,
} from "@arcp/core/errors";
