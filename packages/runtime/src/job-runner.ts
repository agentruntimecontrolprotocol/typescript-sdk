import { randomBytes } from "node:crypto";

import type { TraceId } from "@arcp/core";
import { type BaseEnvelope, buildEnvelope } from "@arcp/core/envelope";
import {
  AgentNotAvailableError,
  AgentVersionNotAvailableError,
  ARCPError,
  CancelledError,
  InternalError,
  InvalidRequestError,
  LeaseExpiredError,
  LeaseSubsetViolationError,
} from "@arcp/core/errors";
import {
  type DelegateBody,
  type Envelope,
  type Lease,
  type LeaseConstraints,
  type MetricBody,
  parseAgentRef,
} from "@arcp/core/messages";
import { newJobId, newMessageId } from "@arcp/core/util";

import { Job, makeJobContext } from "./job.js";
import {
  assertLeaseConstraintsSubset,
  assertLeaseSubset,
  initialBudgetFromLease,
  validateLeaseConstraints,
  validateLeaseShape,
} from "./lease.js";
import type { ARCPServer, SessionContext } from "./server.js";
import { digest, type IdempotencyEntry } from "./stores.js";
import type { AgentHandler, JobContext } from "./types.js";

const DEFAULT_HEARTBEAT_SECONDS = 30;
const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT_JOBS = 100;

type DelegateInterceptor = (body: DelegateBody) => Promise<void>;
type MetricInterceptor = (body: MetricBody) => Promise<void>;
type SubscriberBroadcaster = (env: BaseEnvelope) => void;

/**
 * Owns the job-submission and job-execution pipeline (§7): handler
 * resolution, lease validation, idempotency, the run loop with its
 * timeout/lease-expiry watchdogs, the metric/delegate interceptors, and
 * subscriber broadcast. Also handles §10 delegation child-job creation.
 */
export class JobRunner {
  public constructor(private readonly server: ARCPServer) {}

  public async handleJobSubmit(
    ctx: SessionContext,
    env: Envelope,
  ): Promise<void> {
    if (env.type !== "job.submit") return;
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    const payload = env.payload;

    // Per-session max concurrent jobs cap (§14).
    const caps = this.server.options.caps ?? {};
    const maxConcurrent = caps.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;
    if (ctx.jobs.list().length >= maxConcurrent) {
      await ctx.emitSessionError(
        new InternalError("Max concurrent jobs reached", { retryable: false }),
      );
      return;
    }

    // v1.1 §7.5 — parse agent reference and resolve a handler.
    let parsedAgent: { name: string; version: string | null };
    try {
      parsedAgent = parseAgentRef(payload.agent);
    } catch (error) {
      await ctx.emitJobError(newJobId(), {
        final_status: "error",
        code: "INVALID_REQUEST",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
      return;
    }
    let handler: AgentHandler;
    let resolvedVersion: string;
    try {
      const resolved = this.server.resolveAgent(
        parsedAgent.name,
        parsedAgent.version,
      );
      handler = resolved.handler;
      resolvedVersion = resolved.version;
    } catch (error) {
      // §7.5: version errors emit session.error per spec example (§13.7).
      if (error instanceof AgentVersionNotAvailableError) {
        await ctx.emitSessionError(error);
        return;
      }
      const wrapped =
        error instanceof ARCPError
          ? error
          : new AgentNotAvailableError(
              `Agent "${payload.agent}" is not registered`,
            );
      const jobId = newJobId();
      await ctx.emitJobError(jobId, {
        final_status: "error",
        code: wrapped.code,
        message: wrapped.message,
        retryable: wrapped.retryable,
      });
      return;
    }

    // Lease validation (shape + cost.budget patterns).
    const requestedLease: Lease = payload.lease_request ?? {};
    try {
      validateLeaseShape(requestedLease);
    } catch (error) {
      const wrapped =
        error instanceof ARCPError
          ? error
          : new InvalidRequestError(String(error));
      await ctx.emitJobError(newJobId(), {
        final_status: "error",
        code: wrapped.code,
        message: wrapped.message,
        retryable: wrapped.retryable,
      });
      return;
    }

    // v1.1 §9.5 — validate lease_constraints (UTC, future).
    const leaseConstraints: LeaseConstraints | undefined =
      payload.lease_constraints;
    try {
      validateLeaseConstraints(leaseConstraints);
    } catch (error) {
      const wrapped =
        error instanceof ARCPError
          ? error
          : new InvalidRequestError(String(error));
      await ctx.emitJobError(newJobId(), {
        final_status: "error",
        code: wrapped.code,
        message: wrapped.message,
        retryable: wrapped.retryable,
      });
      return;
    }

    // v1.1 §9.6 — initial budget counters.
    const initialBudget = initialBudgetFromLease(requestedLease);

    // Idempotency: keyed by (principal, idempotency_key).
    const principal = ctx.state.identity?.principal ?? "<anonymous>";
    let idempotencyHit: IdempotencyEntry | null = null;
    if (payload.idempotency_key !== undefined) {
      const key = `${principal}::${payload.idempotency_key}`;
      this.server.idempotencyStore.sweep();
      const existing = this.server.idempotencyStore.get(key);
      if (existing !== undefined && existing.expiresAt > Date.now()) {
        const sameAgent = existing.agent === payload.agent;
        const sameInput = existing.inputDigest === digest(payload.input);
        if (!sameAgent || !sameInput) {
          await ctx.emitJobError(existing.jobId, {
            final_status: "error",
            code: "DUPLICATE_KEY",
            message: `idempotency_key "${payload.idempotency_key}" reused with conflicting params`,
            retryable: false,
            details: { existing_job_id: existing.jobId },
          });
          return;
        }
        idempotencyHit = existing;
      } else {
        ctx.addLocalIdempotencyKey(key);
      }
    }

    // Generate or echo trace_id (§11). Runtime MUST mint one if absent so
    // `job.accepted.payload.trace_id` always has a value to echo back.
    const traceId: TraceId =
      env.trace_id ?? (randomBytes(16).toString("hex") as TraceId);

    const job = new Job({
      options: {
        ...(idempotencyHit === null ? {} : { jobId: idempotencyHit.jobId }),
        sessionId,
        agent: parsedAgent.name,
        agentVersion: resolvedVersion === "" ? null : resolvedVersion,
        lease: requestedLease,
        leaseConstraints,
        initialBudget,
        heartbeatIntervalSeconds:
          this.server.options.heartbeatIntervalSeconds ??
          DEFAULT_HEARTBEAT_SECONDS,
        // exactOptionalPropertyTypes: spread the key only when defined.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        ...(traceId === undefined ? {} : { traceId }),
      },
      send: (out) => ctx.send(out),
      seq: ctx,
      logger: ctx.logger.child({ job_id: "<pending>" }),
    });
    job.submitterPrincipal = principal;
    job.owningSession = ctx;
    this.server.globalJobs.set(job.jobId, job);
    ctx.jobs.register(job);
    Object.assign(job, { logger: ctx.logger.child({ job_id: job.jobId }) });

    if (payload.idempotency_key !== undefined && idempotencyHit === null) {
      const key = `${principal}::${payload.idempotency_key}`;
      const ttl =
        this.server.options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
      this.server.idempotencyStore.set(key, {
        jobId: job.jobId,
        agent: payload.agent,
        inputDigest: digest(payload.input),
        expiresAt: Date.now() + ttl,
      });
    }

    await job.emitAccepted();
    await job.emitRunning();

    const jobCtx = makeJobContext(job);
    void this.runHandler(
      ctx,
      job,
      handler,
      payload.input,
      jobCtx,
      payload.max_runtime_sec,
    );
  }

  public async runHandler(
    ctx: SessionContext,
    job: Job,
    handler: AgentHandler,
    input: unknown,
    jobCtx: JobContext,
    maxRuntimeSec: number | undefined,
  ): Promise<void> {
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    if (maxRuntimeSec !== undefined && maxRuntimeSec > 0) {
      timeoutTimer = setTimeout(() => {
        if (!job.isTerminal) {
          job.abortController.abort(
            new InternalError("max_runtime_sec exceeded"),
          );
          void job.emitErrorEnvelope({
            final_status: "timed_out",
            code: "TIMEOUT",
            message: `Job exceeded max_runtime_sec=${maxRuntimeSec}`,
            retryable: true,
          });
        }
      }, maxRuntimeSec * 1000);
      timeoutTimer.unref();
    }

    // v1.1 §9.5 — lease-expiration watchdog. If expires_at elapses while the
    // job is still running, surface LEASE_EXPIRED as job.error.
    let leaseExpiryTimer: ReturnType<typeof setTimeout> | null = null;
    const expiresAt = job.leaseConstraints?.expires_at;
    if (expiresAt !== undefined) {
      const ms = Date.parse(expiresAt) - Date.now();
      if (Number.isFinite(ms) && ms > 0) {
        leaseExpiryTimer = setTimeout(() => {
          if (!job.isTerminal) {
            void job.emitErrorEnvelope({
              final_status: "error",
              code: "LEASE_EXPIRED",
              message: `Lease expired at ${expiresAt}`,
              retryable: false,
            });
            job.abortController.abort(
              new LeaseExpiredError(`Lease expired at ${expiresAt}`),
            );
          }
        }, ms);
        leaseExpiryTimer.unref();
      } else {
        // Past or invalid — terminate immediately.
        void job.emitErrorEnvelope({
          final_status: "error",
          code: "LEASE_EXPIRED",
          message: `Lease expired at ${expiresAt}`,
          retryable: false,
        });
        ctx.jobs.retire(job.jobId);
        this.server.globalJobs.delete(job.jobId);
        return;
      }
    }

    // Listen for delegate events on this job context — runtime intercepts them.
    const delegateInterceptor = this.makeDelegateInterceptor(ctx, job);
    const wrapped = wrapJobCtx(
      jobCtx,
      delegateInterceptor,
      this.metricInterceptor(job),
      this.subscriberBroadcaster(job),
    );

    try {
      const result = await handler(input, wrapped);
      if (!job.isTerminal) {
        await (job.chunkedResultStarted
          ? // The agent should have called `finalize` on its ResultStream.
            // If not, emit a terminal result_chunk{more:false}+job.result.
            job.emitResult({
              final_status: "success",
              result_id: `res_${job.jobId.replace(/^job_/, "")}_auto`,
            })
          : job.emitResult({
              final_status: "success",
              result,
            }));
      }
    } catch (error) {
      if (job.isTerminal) return;
      const wrappedErr =
        error instanceof ARCPError
          ? error
          : error instanceof Error && error.name === "CancelledError"
            ? new CancelledError(error.message)
            : new InternalError(
                error instanceof Error ? error.message : String(error),
                {
                  cause: error instanceof Error ? error : undefined,
                },
              );
      const finalStatus =
        wrappedErr instanceof CancelledError
          ? "cancelled"
          : wrappedErr.code === "TIMEOUT"
            ? "timed_out"
            : "error";
      await job.emitErrorEnvelope({
        final_status: finalStatus,
        code: wrappedErr.code,
        message: wrappedErr.message,
        retryable: wrappedErr.retryable,
      });
    } finally {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (leaseExpiryTimer !== null) clearTimeout(leaseExpiryTimer);
      ctx.jobs.retire(job.jobId);
      this.server.globalJobs.delete(job.jobId);
      // Drop any active subscriptions for this job.
      this.server.subscribers.delete(job.jobId);
    }
  }

  /**
   * §10 — create a delegated child job under a parent. Resolves the agent,
   * enforces lease subset / constraint subset / budget invariants, then
   * dispatches `runHandler`. Returns a discriminated result so the caller
   * (the delegate interceptor) can surface failures via `tool_result`.
   */
  public async createDelegateJob(
    ctx: SessionContext,
    parent: Job,
    body: DelegateBody,
  ): Promise<{ ok: true; jobId: string } | { ok: false; error: ARCPError }> {
    const requested: Lease = body.lease_request ?? {};
    let parsedAgent: { name: string; version: string | null };
    try {
      parsedAgent = parseAgentRef(body.agent);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof ARCPError
            ? error
            : new InvalidRequestError(
                error instanceof Error ? error.message : String(error),
              ),
      };
    }
    let handler: AgentHandler;
    let resolvedVersion: string;
    try {
      const r = this.server.resolveAgent(parsedAgent.name, parsedAgent.version);
      handler = r.handler;
      resolvedVersion = r.version;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof ARCPError
            ? error
            : new AgentNotAvailableError(
                `Agent "${body.agent}" is not registered`,
              ),
      };
    }
    try {
      validateLeaseShape(requested);
      // Pass parent's REMAINING budget for §9.4 enforcement.
      assertLeaseSubset(requested, parent.lease, parent.budget);
      assertLeaseConstraintsSubset(
        body.lease_constraints,
        parent.leaseConstraints,
      );
      // Child inherits parent expiry implicitly if absent.
      validateLeaseConstraints(body.lease_constraints);
    } catch (error) {
      const wrapped =
        error instanceof LeaseSubsetViolationError
          ? error
          : error instanceof ARCPError
            ? error
            : new InvalidRequestError(String(error));
      return { ok: false, error: wrapped };
    }
    const sessionId = ctx.state.id;
    if (sessionId === undefined) {
      return { ok: false, error: new InternalError("session has no id") };
    }
    // Effective child constraints: child explicit OR inherited from parent.
    const effectiveConstraints: LeaseConstraints | undefined =
      body.lease_constraints ?? parent.leaseConstraints;
    const childBudget = initialBudgetFromLease(requested);
    const child = new Job({
      options: {
        sessionId,
        agent: parsedAgent.name,
        agentVersion: resolvedVersion === "" ? null : resolvedVersion,
        lease: requested,
        leaseConstraints: effectiveConstraints,
        initialBudget: childBudget,
        parentJobId: parent.jobId,
        delegateId: body.delegate_id,
        heartbeatIntervalSeconds:
          this.server.options.heartbeatIntervalSeconds ??
          DEFAULT_HEARTBEAT_SECONDS,
        ...(parent.traceId === undefined ? {} : { traceId: parent.traceId }),
      },
      send: (out) => ctx.send(out),
      seq: ctx,
      logger: ctx.logger.child({
        job_id: "<pending>",
        parent_job_id: parent.jobId,
      }),
    });
    child.submitterPrincipal = parent.submitterPrincipal;
    child.owningSession = ctx;
    this.server.globalJobs.set(child.jobId, child);
    ctx.jobs.register(child);
    Object.assign(child, { logger: ctx.logger.child({ job_id: child.jobId }) });
    await child.emitAccepted();
    await child.emitRunning();
    const childCtx = makeJobContext(child);
    void this.runHandler(ctx, child, handler, body.input, childCtx, undefined);
    return { ok: true, jobId: child.jobId };
  }

  /** Intercept `metric` events to apply v1.1 §9.6 budget decrements. */
  private metricInterceptor(job: Job): MetricInterceptor {
    // eslint-disable-next-line @typescript-eslint/require-await
    return async (body: MetricBody) => {
      // Decrement the matching budget counter (if any).
      const remaining = job.applyCostMetric(body.name, body.value, body.unit);
      if (
        remaining !== null &&
        body.unit !== undefined && // Debounced budget.remaining metric (best-effort).
        job.shouldEmitBudgetRemaining(body.unit)
      ) {
        // Emit *after* the original metric — but we need to do that from
        // the wrapper. Schedule via microtask so the original event has
        // flushed.
        queueMicrotask(() => {
          if (job.isTerminal) return;
          void job
            .emitEventKind("metric", {
              name: "cost.budget.remaining",
              value: remaining,
              unit: body.unit,
            })
            .catch(() => undefined);
        });
      }
    };
  }

  /**
   * Build a hook that re-broadcasts the job's events to every subscriber
   * session (other than the submitting session).
   */
  private subscriberBroadcaster(job: Job): SubscriberBroadcaster {
    return (env: BaseEnvelope) => {
      const subs = this.server.subscribers.get(job.jobId);
      if (subs === undefined || subs.size === 0) return;
      for (const sub of subs) {
        // Re-emit with the subscriber's session-scoped event_seq.
        void forwardEventToSubscriber(sub, env).catch(() => undefined);
      }
    };
  }

  private makeDelegateInterceptor(
    ctx: SessionContext,
    parent: Job,
  ): DelegateInterceptor {
    return async (body: DelegateBody) => {
      // Emit the delegate event on the parent job first (§10.1).
      await parent.emitEventKind("delegate", body);
      const outcome = await this.createDelegateJob(ctx, parent, body);
      if (!outcome.ok) {
        // §10.2: report failure via tool_result on PARENT job.
        await parent.emitEventKind("tool_result", {
          call_id: body.delegate_id,
          error: outcome.error.toPayload(),
        });
      }
    };
  }
}

export async function forwardEventToSubscriber(
  sub: SessionContext,
  src: BaseEnvelope,
): Promise<void> {
  if (sub.state.id === undefined) return;
  // Build a fresh envelope: same payload/type/job_id but new id and a new
  // session-scoped event_seq. Preserve trace_id when present.
  const env = buildEnvelope({
    id: newMessageId(),
    type: src.type,
    payload: src.payload,
    optional: {
      session_id: sub.state.id,
      ...(src.job_id === undefined ? {} : { job_id: src.job_id }),
      ...(src.trace_id === undefined ? {} : { trace_id: src.trace_id }),
      ...(src.event_seq === undefined
        ? {}
        : { event_seq: sub.nextEventSeq() }),
    },
  });
  await sub.send(env);
}

function wrapJobCtx(
  ctx: JobContext,
  interceptor: DelegateInterceptor,
  metricInterceptor: MetricInterceptor,
  // subscriberBroadcaster is invoked at the Job-emit-level via a Job wrapper;
  // event broadcasting actually hooks via the SessionContext.send pipeline,
  // not here. The argument is retained for future expansion.
  _broadcaster: SubscriberBroadcaster,
): JobContext {
  return {
    ...ctx,
    async delegate(body: DelegateBody) {
      await interceptor(body);
    },
    async metric(body) {
      await ctx.metric(body);
      await metricInterceptor(body);
    },
  };
}
