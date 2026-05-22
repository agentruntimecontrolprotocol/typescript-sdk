import { randomBytes } from "node:crypto";

import type { SessionId, TraceId } from "@agentruntimecontrolprotocol/core";
import type { BaseEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
/* eslint-disable max-lines, max-depth */
import {
  AgentNotAvailableError,
  ARCPError,
  InternalError,
  InvalidRequestError,
  LeaseExpiredError,
} from "@agentruntimecontrolprotocol/core/errors";
import {
  type DelegateBody,
  type Envelope,
  type Lease,
  type LeaseConstraints,
  type MetricBody,
  parseAgentRef,
} from "@agentruntimecontrolprotocol/core/messages";

import {
  type DelegateOutcome,
  emitAgentResolveError,
  emitArcpError,
  emitHandlerFailure,
  emitParseError,
  forwardEventToSubscriber,
  type MetricInterceptor,
  type ResolvedSubmitAgent,
  runAndEmitResult,
  scheduleRuntimeTimeout,
  type SubmitPayload,
  type SubscriberBroadcaster,
  validateDelegateLease,
  wrapJobCtx,
} from "./job-runner-helpers.js";
import { Job, makeJobContext } from "./job.js";
import {
  initialBudgetFromLease,
  validateLeaseConstraints,
  validateLeaseShape,
} from "./lease.js";
import type { ARCPServer, SessionContext } from "./server.js";
import { digest, type IdempotencyEntry } from "./stores.js";
import type { AgentHandler, IssuedCredential, JobContext } from "./types.js";

const DEFAULT_HEARTBEAT_SECONDS = 30;
const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT_JOBS = 100;

type DelegateInterceptor = (body: DelegateBody) => Promise<void>;

interface LeaseFields {
  requestedLease: Lease;
  leaseConstraints: LeaseConstraints | undefined;
  initialBudget: ReadonlyMap<string, number>;
}

interface AcceptDispatchArgs {
  ctx: SessionContext;
  env: Envelope;
  sessionId: SessionId;
  resolved: ResolvedSubmitAgent;
  leaseFields: LeaseFields;
  principal: string;
  idempotency: IdempotencyEntry | null;
}

interface ConstructJobInput {
  ctx: SessionContext;
  env: Envelope;
  sessionId: SessionId;
  payload: SubmitPayload;
  parsedAgentName: string;
  resolvedVersion: string;
  leaseFields: LeaseFields;
  idempotencyHit: IdempotencyEntry | null;
  principal: string;
}

interface RunHandlerArgs {
  ctx: SessionContext;
  job: Job;
  handler: AgentHandler;
  input: unknown;
  jobCtx: JobContext;
  maxRuntimeSec: number | undefined;
}

interface RecordIdempotencyArgs {
  job: Job;
  principal: string;
  payload: SubmitPayload;
  idempotencyHit: IdempotencyEntry | "conflict" | null;
}

interface ConstructDelegateChildInput {
  ctx: SessionContext;
  parent: Job;
  body: DelegateBody;
  sessionId: SessionId;
  requested: Lease;
  parsedAgentName: string;
  resolvedVersion: string;
}

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
    if (await this.rejectIfOverConcurrencyCap(ctx)) return;
    const resolved = await this.resolveSubmitAgent(ctx, env.payload);
    if (resolved === null) return;
    const leaseFields = await this.validateLeaseAndConstraints(
      ctx,
      env.payload,
    );
    if (leaseFields === null) return;
    const principal = ctx.state.identity?.principal ?? "<anonymous>";
    const idempotency = await this.checkIdempotency(
      ctx,
      principal,
      env.payload,
    );
    if (idempotency === "conflict") return;
    await this.acceptAndDispatchSubmit({
      ctx,
      env,
      sessionId,
      resolved,
      leaseFields,
      principal,
      idempotency,
    });
  }

  private async acceptAndDispatchSubmit(
    args: AcceptDispatchArgs,
  ): Promise<void> {
    const { ctx, env, resolved, principal, idempotency } = args;
    if (env.type !== "job.submit") return;
    const job = this.constructJob({
      ctx,
      env,
      sessionId: args.sessionId,
      payload: env.payload,
      parsedAgentName: resolved.parsedAgent.name,
      resolvedVersion: resolved.resolvedVersion,
      leaseFields: args.leaseFields,
      idempotencyHit: idempotency,
      principal,
    });
    this.recordIdempotency({
      job,
      principal,
      payload: env.payload,
      idempotencyHit: idempotency,
    });
    if (!(await this.issueCredentials(ctx, job))) return;
    await job.emitAccepted();
    await job.emitRunning();
    void this.runHandler({
      ctx,
      job,
      handler: resolved.handler,
      input: env.payload.input,
      jobCtx: makeJobContext(job),
      maxRuntimeSec: env.payload.max_runtime_sec,
    });
  }

  private async rejectIfOverConcurrencyCap(
    ctx: SessionContext,
  ): Promise<boolean> {
    const maxConcurrent =
      this.server.options.caps?.maxConcurrentJobs ??
      DEFAULT_MAX_CONCURRENT_JOBS;
    if (ctx.jobs.list().length < maxConcurrent) return false;
    await ctx.emitSessionError(
      new InternalError("Max concurrent jobs reached", { retryable: false }),
    );
    return true;
  }

  private async resolveSubmitAgent(
    ctx: SessionContext,
    payload: SubmitPayload,
  ): Promise<ResolvedSubmitAgent | null> {
    let parsedAgent: { name: string; version: string | null };
    try {
      parsedAgent = parseAgentRef(payload.agent);
    } catch (error) {
      await emitParseError(ctx, error);
      return null;
    }
    try {
      const r = this.server.resolveAgent(parsedAgent.name, parsedAgent.version);
      return { parsedAgent, handler: r.handler, resolvedVersion: r.version };
    } catch (error) {
      await emitAgentResolveError(ctx, error, payload.agent);
      return null;
    }
  }

  private async validateLeaseAndConstraints(
    ctx: SessionContext,
    payload: SubmitPayload,
  ): Promise<{
    requestedLease: Lease;
    leaseConstraints: LeaseConstraints | undefined;
    initialBudget: ReadonlyMap<string, number>;
  } | null> {
    const requestedLease: Lease = payload.lease_request ?? {};
    try {
      validateLeaseShape(requestedLease);
    } catch (error) {
      await emitArcpError(ctx, error);
      return null;
    }
    const leaseConstraints = payload.lease_constraints;
    try {
      validateLeaseConstraints(leaseConstraints);
    } catch (error) {
      await emitArcpError(ctx, error);
      return null;
    }
    return {
      requestedLease,
      leaseConstraints,
      initialBudget: initialBudgetFromLease(requestedLease),
    };
  }

  private async checkIdempotency(
    ctx: SessionContext,
    principal: string,
    payload: SubmitPayload,
  ): Promise<IdempotencyEntry | "conflict" | null> {
    if (payload.idempotency_key === undefined) return null;
    const key = `${principal}::${payload.idempotency_key}`;
    this.server.idempotencyStore.sweep();
    const existing = this.server.idempotencyStore.get(key);
    if (existing === undefined || existing.expiresAt <= Date.now()) {
      ctx.addLocalIdempotencyKey(key);
      return null;
    }
    const sameAgent = existing.agent === payload.agent;
    const sameInput = existing.inputDigest === digest(payload.input);
    if (sameAgent && sameInput) return existing;
    await ctx.emitJobError(existing.jobId, {
      final_status: "error",
      code: "DUPLICATE_KEY",
      message: `idempotency_key "${payload.idempotency_key}" reused with conflicting params`,
      retryable: false,
      details: { existing_job_id: existing.jobId },
    });
    return "conflict";
  }

  private constructJob(input: ConstructJobInput): Job {
    const traceId: TraceId =
      input.env.trace_id ?? randomBytes(16).toString("hex");
    const idempotencyHit = input.idempotencyHit;
    const job = new Job({
      options: {
        ...(idempotencyHit === null ? {} : { jobId: idempotencyHit.jobId }),
        sessionId: input.sessionId,
        agent: input.parsedAgentName,
        agentVersion:
          input.resolvedVersion === "" ? null : input.resolvedVersion,
        lease: input.leaseFields.requestedLease,
        leaseConstraints: input.leaseFields.leaseConstraints,
        initialBudget: input.leaseFields.initialBudget,
        heartbeatIntervalSeconds:
          this.server.options.heartbeatIntervalSeconds ??
          DEFAULT_HEARTBEAT_SECONDS,
        // exactOptionalPropertyTypes: spread the key only when defined.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        ...(traceId === undefined ? {} : { traceId }),
      },
      send: (out) => input.ctx.send(out),
      seq: input.ctx,
      logger: input.ctx.logger.child({ job_id: "<pending>" }),
    });
    job.submitterPrincipal = input.principal;
    job.owningSession = input.ctx;
    this.server.globalJobs.set(job.jobId, job);
    input.ctx.jobs.register(job);
    Object.assign(job, {
      logger: input.ctx.logger.child({ job_id: job.jobId }),
    });
    return job;
  }

  private recordIdempotency(args: RecordIdempotencyArgs): void {
    const { job, principal, payload, idempotencyHit } = args;
    if (payload.idempotency_key === undefined) return;
    if (idempotencyHit !== null) return;
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

  /**
   * §9.7 — mint credentials for a newly accepted job.
   *
   * Returns `true` if provisioning succeeded (or if no provisioner is
   * configured). Returns `false` if provisioning or store-recording failed;
   * the caller MUST treat `false` as "job already rejected" and return
   * without further work.
   *
   * On failure this method:
   *   1. Emits a `job.error` envelope with `INTERNAL_ERROR`.
   *   2. Revokes any already-issued credentials (best-effort).
   *   3. Retires the job from `ctx.jobs` and `globalJobs`.
   */
  // Credential provisioning has several cleanup paths; keep them co-located so
  // issuance, store persistence, rejection, and best-effort revocation stay in
  // the same transaction-shaped block.
  // eslint-disable-next-line max-lines-per-function
  private async issueCredentials(
    ctx: SessionContext,
    job: Job,
  ): Promise<boolean> {
    const provisioner = this.server.options.credentialProvisioner;
    if (provisioner === undefined) return true;
    // `credentialStore` is always present when `credentialProvisioner` is set
    // (validated in ARCPServer constructor).
    const store = this.server.options.credentialStore;
    if (store === undefined) {
      job.logger.error(
        { jobId: job.jobId },
        "credential store missing; rejecting job",
      );
      await job.emitErrorEnvelope({
        final_status: "error",
        code: "INTERNAL_ERROR",
        message: "Credential store unavailable",
        retryable: true,
      });
      ctx.jobs.retire(job.jobId);
      this.server.globalJobs.delete(job.jobId);
      return false;
    }

    let issued: IssuedCredential[];
    try {
      issued = await provisioner.issue({
        jobId: job.jobId,
        parentJobId: job.parentJobId,
        lease: job.lease,
        leaseConstraints: job.leaseConstraints,
        initialBudget: job.initialBudget,
        principal: job.submitterPrincipal,
        traceId: job.traceId,
      });
    } catch (error) {
      job.logger.error(
        { err: error, jobId: job.jobId },
        "credential provisioner threw; rejecting job",
      );
      await job.emitErrorEnvelope({
        final_status: "error",
        code: "INTERNAL_ERROR",
        message: "Credential provisioning failed",
        retryable: true,
      });
      ctx.jobs.retire(job.jobId);
      this.server.globalJobs.delete(job.jobId);
      return false;
    }

    if (issued.length === 0) return true;

    const issuedAt = new Date().toISOString();
    for (const cred of issued) {
      try {
        await store.add({
          jobId: job.jobId,
          credentialId: cred.wire.id,
          provisionerId: cred.provisionerId,
          issuedAt,
        });
      } catch (error) {
        job.logger.error(
          { err: error, jobId: job.jobId, credentialId: cred.wire.id },
          "credential store add failed; rejecting job",
        );
        // Revoke all already-issued credentials (best-effort).
        for (const c of issued) {
          try {
            await provisioner.revoke(c.provisionerId);
          } catch {
            /* swallow — revocation is best-effort */
          }
        }
        await job.emitErrorEnvelope({
          final_status: "error",
          code: "INTERNAL_ERROR",
          message: "Credential store unavailable",
          retryable: true,
        });
        ctx.jobs.retire(job.jobId);
        this.server.globalJobs.delete(job.jobId);
        return false;
      }
    }

    job.credentials = issued;
    return true;
  }

  public async runHandler(args: RunHandlerArgs): Promise<void> {
    const { ctx, job, handler, input, jobCtx, maxRuntimeSec } = args;
    const timeoutTimer = scheduleRuntimeTimeout(job, maxRuntimeSec);
    const leaseTimer = this.scheduleLeaseExpiry(ctx, job);
    if (leaseTimer === "expired") return;

    const wrapped = wrapJobCtx({
      base: jobCtx,
      delegateInterceptor: this.makeDelegateInterceptor(ctx, job),
      metricInterceptor: this.metricInterceptor(job),
      broadcast: this.subscriberBroadcaster(job),
    });

    try {
      await runAndEmitResult({ job, handler, input, wrappedCtx: wrapped });
    } catch (error) {
      await emitHandlerFailure(job, error);
    } finally {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (leaseTimer !== null) clearTimeout(leaseTimer);
      ctx.jobs.retire(job.jobId);
      this.server.globalJobs.delete(job.jobId);
      this.server.subscribers.delete(job.jobId);
      const provisioner = this.server.options.credentialProvisioner;
      const store = this.server.options.credentialStore;
      if (provisioner !== undefined && store !== undefined) {
        await job.revokeAll(provisioner, store);
      }
    }
  }

  private scheduleLeaseExpiry(
    ctx: SessionContext,
    job: Job,
  ): ReturnType<typeof setTimeout> | "expired" | null {
    const expiresAt = job.leaseConstraints?.expires_at;
    if (expiresAt === undefined) return null;
    const ms = Date.parse(expiresAt) - Date.now();
    if (Number.isFinite(ms) && ms > 0) {
      const timer = setTimeout(() => {
        if (job.isTerminal) return;
        void job.emitErrorEnvelope({
          final_status: "error",
          code: "LEASE_EXPIRED",
          message: `Lease expired at ${expiresAt}`,
          retryable: false,
        });
        job.abortController.abort(
          new LeaseExpiredError(`Lease expired at ${expiresAt}`),
        );
      }, ms);
      timer.unref();
      return timer;
    }
    // Past or invalid — terminate immediately.
    void job.emitErrorEnvelope({
      final_status: "error",
      code: "LEASE_EXPIRED",
      message: `Lease expired at ${expiresAt}`,
      retryable: false,
    });
    ctx.jobs.retire(job.jobId);
    this.server.globalJobs.delete(job.jobId);
    return "expired";
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
  ): Promise<DelegateOutcome> {
    const requested: Lease = body.lease_request ?? {};
    const agent = this.resolveDelegateAgent(body);
    if (!agent.ok) return agent;
    const leaseCheck = validateDelegateLease(requested, parent, body);
    if (leaseCheck !== null) return { ok: false, error: leaseCheck };
    const sessionId = ctx.state.id;
    if (sessionId === undefined) {
      return { ok: false, error: new InternalError("session has no id") };
    }
    const child = this.constructDelegateChild({
      ctx,
      parent,
      body,
      sessionId,
      requested,
      parsedAgentName: agent.parsedAgent.name,
      resolvedVersion: agent.resolvedVersion,
    });
    if (!(await this.issueCredentials(ctx, child))) {
      return { ok: false, error: new InternalError("Credential provisioning failed") };
    }
    await child.emitAccepted();
    await child.emitRunning();
    void this.runHandler({
      ctx,
      job: child,
      handler: agent.handler,
      input: body.input,
      jobCtx: makeJobContext(child),
      maxRuntimeSec: undefined,
    });
    return { ok: true, jobId: child.jobId };
  }

  private resolveDelegateAgent(
    body: DelegateBody,
  ): ({ ok: true } & ResolvedSubmitAgent) | { ok: false; error: ARCPError } {
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
    try {
      const r = this.server.resolveAgent(parsedAgent.name, parsedAgent.version);
      return {
        ok: true,
        parsedAgent,
        handler: r.handler,
        resolvedVersion: r.version,
      };
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
  }

  private constructDelegateChild(input: ConstructDelegateChildInput): Job {
    const { ctx, parent, body, sessionId, requested } = input;
    const effectiveConstraints: LeaseConstraints | undefined =
      body.lease_constraints ?? parent.leaseConstraints;
    const child = new Job({
      options: {
        sessionId,
        agent: input.parsedAgentName,
        agentVersion:
          input.resolvedVersion === "" ? null : input.resolvedVersion,
        lease: requested,
        leaseConstraints: effectiveConstraints,
        initialBudget: initialBudgetFromLease(requested),
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
    return child;
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
