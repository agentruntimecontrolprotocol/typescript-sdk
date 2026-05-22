import type { JobId, SessionId, TraceId } from "@agentruntimecontrolprotocol/core";
import { buildEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import {
  CancelledError,
  HeartbeatLostError,
  InternalError,
  InvalidRequestError,
} from "@agentruntimecontrolprotocol/core/errors";
import type { Logger } from "@agentruntimecontrolprotocol/core/logger";
import type {
  JobErrorPayload,
  JobResultPayload,
  JobStateName,
  Lease,
  LeaseConstraints,
} from "@agentruntimecontrolprotocol/core/messages";
import { newJobId, newMessageId, nowTimestamp } from "@agentruntimecontrolprotocol/core/util";

import type { CredentialProvisioner, IssuedCredential } from "./credential-provisioner.js";
import type { CredentialStore, CredentialStoreEntry } from "./credential-store.js";
import type { EventSeqSource, JobOptions, JobSend } from "./types.js";

/** Constructor dependency bag for {@link Job}. */
export interface JobDependencies {
  readonly options: JobOptions;
  readonly send: JobSend;
  readonly seq: EventSeqSource;
  readonly logger: Logger;
}

// ARCP v1.1 §7-§8 job execution.
//
// State machine: pending → running → {success | error | cancelled | timed_out}.
// All event-bearing envelopes (job.event / job.result / job.error) carry a
// session-scoped `event_seq` stamped by the SessionContext at emit time.

const JOB_TRANSITIONS = {
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
} as const satisfies Record<JobStateName, ReadonlySet<JobStateName>>;

const TERMINAL = new Set<JobStateName>([
  "success",
  "error",
  "cancelled",
  "timed_out",
]);

/**
 * Per-job state machine (§7.3 / §8).
 *
 * Owns the job's lifecycle, the abort signal exposed to the agent, the
 * heartbeat watchdog, and the emission of `job.accepted` /
 * `job.event` / `job.result` / `job.error` envelopes. The session
 * provides the monotonic `event_seq` source.
 */
export class Job {
  public readonly jobId: JobId;
  public readonly sessionId: SessionId;
  public readonly agent: string;
  /** v1.1 §7.5 — resolved version, or null if none was advertised. */
  public readonly agentVersion: string | null;
  public readonly lease: Lease;
  public readonly leaseConstraints: LeaseConstraints | undefined;
  /** v1.1 §9.6 — mutable per-currency budget counters. */
  public readonly budget: Map<string, number>;
  /** v1.1 §9.6 — initial budget for inclusion in `job.accepted`. */
  public readonly initialBudget: Map<string, number>;
  public readonly parentJobId: JobId | undefined;
  public readonly delegateId: string | undefined;
  public readonly traceId: TraceId | undefined;
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
  public owningSession: { state: { id: SessionId | undefined } } | undefined =
    undefined;
  public state: JobStateName = "pending";
  public readonly abortController = new AbortController();
  /** v1.1 §8.4 — set true after the first `result_chunk` event is emitted. */
  public chunkedResultStarted = false;
  /**
   * v1.1 §9.7–§9.8 — short-lived credentials issued by the provisioner at
   * job acceptance. Wire shapes are included in `job.accepted`; provisioner
   * ids are used for revocation. `wire.value` MUST NOT appear in logs.
   */
  public credentials: readonly IssuedCredential[] = [];
  /** Track last-emitted remaining per currency for chatty-emit debounce. */
  private readonly lastEmittedRemaining = new Map<string, number>();

  private missedHeartbeats = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly missesAllowed: number;
  private readonly heartbeatIntervalMs: number;

  private readonly send: JobSend;
  private readonly seq: EventSeqSource;
  public readonly logger: Logger;

  public constructor(deps: JobDependencies) {
    const { options, send, seq, logger } = deps;
    this.send = send;
    this.seq = seq;
    this.logger = logger;
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
    this.credentials = options.credentials ?? [];
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
        ...(this.credentials.length > 0
          ? { credentials: this.credentials.map((c) => c.wire) }
          : {}),
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

  // -------- Credential revocation (§9.7–§9.8) -------------------

  /**
   * Revoke all credentials issued for this job.
   *
   * Calls `store.removeByJob()` to atomically dequeue all outstanding
   * entries, then calls `provisioner.revoke()` for each. Per §9.7,
   * revocation failures MUST NOT propagate — each call is wrapped in a
   * try/catch that logs a warning and continues. `wire.value` is NEVER
   * referenced here.
   */
  public async revokeAll(
    provisioner: CredentialProvisioner,
    store: CredentialStore,
  ): Promise<void> {
    let entries: readonly CredentialStoreEntry[];
    try {
      entries = await store.removeByJob(this.jobId);
    } catch (error) {
      this.logger.warn(
        { err: error, jobId: this.jobId },
        "credential store removeByJob failed; credentials may not be revoked",
      );
      return;
    }
    for (const entry of entries) {
      try {
        await provisioner.revoke(entry.provisionerId);
        this.logger.debug(
          { jobId: this.jobId, credentialId: entry.credentialId },
          "revoked provisioned credential",
        );
      } catch (error) {
        this.logger.warn(
          { err: error, jobId: this.jobId, credentialId: entry.credentialId },
          "credential revocation failed (non-fatal)",
        );
      }
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

export { makeJobContext } from "./job-context.js";

// Re-export commonly used error types so consumers can import in one place.

export {
  TimeoutError,
  CancelledError,
  HeartbeatLostError,
  InternalError,
} from "@agentruntimecontrolprotocol/core/errors";
