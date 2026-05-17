import { type BaseEnvelope, buildEnvelope } from "@arcp/core/envelope";
import {
  AgentNotAvailableError,
  AgentVersionNotAvailableError,
  ARCPError,
  CancelledError,
  InternalError,
  InvalidRequestError,
  LeaseSubsetViolationError,
} from "@arcp/core/errors";
import type {
  DelegateBody,
  Envelope,
  Lease,
  MetricBody,
} from "@arcp/core/messages";
import { newJobId, newMessageId } from "@arcp/core/util";

import type { Job } from "./job.js";
import {
  assertLeaseConstraintsSubset,
  assertLeaseSubset,
  validateLeaseConstraints,
  validateLeaseShape,
} from "./lease.js";
import type { SessionContext } from "./server.js";
import type { AgentHandler, JobContext } from "./types.js";

// Narrow extracted from `Envelope` for ergonomics inside the submit pipeline.
export type SubmitPayload = Extract<
  Envelope,
  { type: "job.submit" }
>["payload"];

export interface ResolvedSubmitAgent {
  parsedAgent: { name: string; version: string | null };
  handler: AgentHandler;
  resolvedVersion: string;
}

export type DelegateOutcome =
  | { ok: true; jobId: string }
  | { ok: false; error: ARCPError };

export type DelegateInterceptor = (body: DelegateBody) => Promise<void>;
export type MetricInterceptor = (body: MetricBody) => Promise<void>;
export type SubscriberBroadcaster = (env: BaseEnvelope) => void;

export interface WrapJobCtxArgs {
  base: JobContext;
  delegateInterceptor: DelegateInterceptor;
  metricInterceptor: MetricInterceptor;
  // subscriberBroadcaster is invoked at the Job-emit-level via a Job wrapper;
  // event broadcasting actually hooks via the SessionContext.send pipeline,
  // not here. The field is retained for future expansion.
  broadcast: SubscriberBroadcaster;
}

export function wrapJobCtx(args: WrapJobCtxArgs): JobContext {
  const { base, delegateInterceptor, metricInterceptor } = args;
  return {
    ...base,
    async delegate(body: DelegateBody) {
      await delegateInterceptor(body);
    },
    async metric(body) {
      await base.metric(body);
      await metricInterceptor(body);
    },
  };
}

export async function emitParseError(
  ctx: SessionContext,
  error: unknown,
): Promise<void> {
  await ctx.emitJobError(newJobId(), {
    final_status: "error",
    code: "INVALID_REQUEST",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  });
}

export async function emitAgentResolveError(
  ctx: SessionContext,
  error: unknown,
  agentRef: string,
): Promise<void> {
  if (error instanceof AgentVersionNotAvailableError) {
    // §7.5: version errors emit session.error per spec example (§13.7).
    await ctx.emitSessionError(error);
    return;
  }
  const wrapped =
    error instanceof ARCPError
      ? error
      : new AgentNotAvailableError(`Agent "${agentRef}" is not registered`);
  await ctx.emitJobError(newJobId(), {
    final_status: "error",
    code: wrapped.code,
    message: wrapped.message,
    retryable: wrapped.retryable,
  });
}

export async function emitArcpError(
  ctx: SessionContext,
  error: unknown,
): Promise<void> {
  const wrapped =
    error instanceof ARCPError ? error : new InvalidRequestError(String(error));
  await ctx.emitJobError(newJobId(), {
    final_status: "error",
    code: wrapped.code,
    message: wrapped.message,
    retryable: wrapped.retryable,
  });
}

export function scheduleRuntimeTimeout(
  job: Job,
  maxRuntimeSec: number | undefined,
): ReturnType<typeof setTimeout> | null {
  if (maxRuntimeSec === undefined || maxRuntimeSec <= 0) return null;
  const timer = setTimeout(() => {
    if (job.isTerminal) return;
    job.abortController.abort(new InternalError("max_runtime_sec exceeded"));
    void job.emitErrorEnvelope({
      final_status: "timed_out",
      code: "TIMEOUT",
      message: `Job exceeded max_runtime_sec=${maxRuntimeSec}`,
      retryable: true,
    });
  }, maxRuntimeSec * 1000);
  timer.unref();
  return timer;
}

export interface RunAndEmitArgs {
  job: Job;
  handler: AgentHandler;
  input: unknown;
  wrappedCtx: JobContext;
}

export async function runAndEmitResult({
  job,
  handler,
  input,
  wrappedCtx,
}: RunAndEmitArgs): Promise<void> {
  const result = await handler(input, wrappedCtx);
  if (job.isTerminal) return;
  if (job.chunkedResultStarted) {
    // The agent should have called `finalize` on its ResultStream.
    // If not, emit a terminal result_chunk{more:false}+job.result.
    await job.emitResult({
      final_status: "success",
      result_id: `res_${job.jobId.replace(/^job_/, "")}_auto`,
    });
    return;
  }
  await job.emitResult({ final_status: "success", result });
}

export async function emitHandlerFailure(
  job: Job,
  error: unknown,
): Promise<void> {
  if (job.isTerminal) return;
  const wrapped = wrapHandlerError(error);
  const finalStatus: "cancelled" | "timed_out" | "error" =
    wrapped instanceof CancelledError
      ? "cancelled"
      : wrapped.code === "TIMEOUT"
        ? "timed_out"
        : "error";
  await job.emitErrorEnvelope({
    final_status: finalStatus,
    code: wrapped.code,
    message: wrapped.message,
    retryable: wrapped.retryable,
  });
}

function wrapHandlerError(error: unknown): ARCPError {
  if (error instanceof ARCPError) return error;
  if (error instanceof Error && error.name === "CancelledError") {
    return new CancelledError(error.message);
  }
  return new InternalError(
    error instanceof Error ? error.message : String(error),
    { cause: error instanceof Error ? error : undefined },
  );
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
      ...(src.event_seq === undefined ? {} : { event_seq: sub.nextEventSeq() }),
    },
  });
  await sub.send(env);
}

export function validateDelegateLease(
  requested: Lease,
  parent: Job,
  body: DelegateBody,
): ARCPError | null {
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
    return null;
  } catch (error) {
    if (error instanceof LeaseSubsetViolationError) return error;
    if (error instanceof ARCPError) return error;
    return new InvalidRequestError(String(error));
  }
}
