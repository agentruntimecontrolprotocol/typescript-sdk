import type { JobId } from "@arcp/core";
import type { BaseEnvelope } from "@arcp/core/envelope";
import { buildEnvelope } from "@arcp/core/envelope";
import { PermissionDeniedError } from "@arcp/core/errors";
import type {
  Envelope,
  JobListEntry,
  SessionListJobsFilter,
} from "@arcp/core/messages";
import { newMessageId } from "@arcp/core/util";

import { forwardEventToSubscriber } from "./job-runner.js";
import type { Job } from "./job.js";
import {
  compareJobListEntries,
  compileListJobsFilter,
  type ListJobsFilter,
  paginateJobList,
} from "./list-jobs.js";
import type { ARCPServer } from "./server.js";
import type { SessionContext } from "./session-context.js";
import type { JobAuthorizationPolicy } from "./types.js";

export function defaultJobAuthorizationPolicy(
  job: Job,
  principal: string | undefined,
): boolean {
  return job.submitterPrincipal === principal;
}

export async function handleListJobs(
  server: ARCPServer,
  ctx: SessionContext,
  env: Envelope,
): Promise<void> {
  if (env.type !== "session.list_jobs") return;
  const sessionId = ctx.state.id;
  if (sessionId === undefined) return;
  const candidates = buildListJobsCandidates(server, ctx, env.payload.filter);
  candidates.sort(compareJobListEntries);
  const { page, nextCursor } = paginateJobList(
    candidates,
    env.payload.cursor ?? undefined,
    env.payload.limit ?? 100,
  );
  await ctx.send(
    buildEnvelope({
      id: newMessageId(),
      type: "session.jobs" as const,
      payload: { request_id: env.id, jobs: page, next_cursor: nextCursor },
      optional: { session_id: sessionId },
    }),
  );
}

function buildListJobsCandidates(
  server: ARCPServer,
  ctx: SessionContext,
  rawFilter: SessionListJobsFilter | undefined,
): JobListEntry[] {
  const principal = ctx.state.identity?.principal;
  const policy: JobAuthorizationPolicy =
    server.options.jobAuthorizationPolicy ?? defaultJobAuthorizationPolicy;
  const filter: ListJobsFilter = compileListJobsFilter(rawFilter ?? {});
  const out: JobListEntry[] = [];
  for (const job of server.globalJobs.values()) {
    if (!policy(job, principal)) continue;
    if (!filter.matches(job)) continue;
    out.push({
      job_id: job.jobId,
      agent: job.agentRef,
      status: job.state,
      lease: job.lease,
      parent_job_id: job.parentJobId ?? null,
      created_at: job.createdAt,
      ...(job.traceId === undefined ? {} : { trace_id: job.traceId }),
      last_event_seq: ctx.latestEventSeq,
    });
  }
  return out;
}

export async function handleJobSubscribe(
  server: ARCPServer,
  ctx: SessionContext,
  env: Envelope,
): Promise<void> {
  if (env.type !== "job.subscribe") return;
  const sessionId = ctx.state.id;
  if (sessionId === undefined) return;
  const jobId = env.payload.job_id;
  const job = server.globalJobs.get(jobId);
  if (job === undefined) {
    await emitSubscribeJobNotFound(ctx, jobId);
    return;
  }
  if (!authorizeSubscribe(server, ctx, job)) {
    await ctx.emitSessionError(
      new PermissionDeniedError(
        "Subscriber's principal is not authorized to observe this job",
      ),
    );
    return;
  }
  registerSubscriber(server, ctx, jobId);
  const replayed = await maybeReplaySubscribeHistory({
    server,
    ctx,
    job,
    env,
  });
  await ctx.send(
    buildEnvelope({
      id: newMessageId(),
      type: "job.subscribed" as const,
      payload: buildSubscribedPayload(job, ctx.latestEventSeq, replayed),
      optional: { session_id: sessionId, job_id: jobId },
    }),
  );
}

interface MaybeReplayArgs {
  server: ARCPServer;
  ctx: SessionContext;
  job: Job;
  env: Extract<Envelope, { type: "job.subscribe" }>;
}

async function maybeReplaySubscribeHistory(
  args: MaybeReplayArgs,
): Promise<boolean> {
  if (args.env.payload.history !== true) return false;
  return replaySubscribeHistory({
    server: args.server,
    ctx: args.ctx,
    job: args.job,
    fromSeq: args.env.payload.from_event_seq,
  });
}

async function emitSubscribeJobNotFound(
  ctx: SessionContext,
  jobId: JobId,
): Promise<void> {
  await ctx.emitJobError(jobId, {
    final_status: "error",
    code: "JOB_NOT_FOUND",
    message: `Job "${jobId}" not found`,
    retryable: false,
  });
}

function authorizeSubscribe(
  server: ARCPServer,
  ctx: SessionContext,
  job: Job,
): boolean {
  const principal = ctx.state.identity?.principal;
  const policy: JobAuthorizationPolicy =
    server.options.jobAuthorizationPolicy ?? defaultJobAuthorizationPolicy;
  return policy(job, principal);
}

function registerSubscriber(
  server: ARCPServer,
  ctx: SessionContext,
  jobId: JobId,
): void {
  let set = server.subscribers.get(jobId);
  if (set === undefined) {
    set = new Set<SessionContext>();
    server.subscribers.set(jobId, set);
  }
  set.add(ctx);
  ctx.subscriptions.set(jobId, () => {
    const s = server.subscribers.get(jobId);
    if (s === undefined) return;
    s.delete(ctx);
    if (s.size === 0) server.subscribers.delete(jobId);
  });
}

interface ReplaySubscribeHistoryArgs {
  server: ARCPServer;
  ctx: SessionContext;
  job: Job;
  fromSeq: number | undefined;
}

async function replaySubscribeHistory(
  args: ReplaySubscribeHistoryArgs,
): Promise<boolean> {
  const { server, ctx, job, fromSeq } = args;
  if (job.owningSession === undefined) return false;
  const ownerSessionId = job.owningSession.state.id;
  if (ownerSessionId === undefined) return false;
  try {
    const events = await server.eventLog.readSinceSeq(
      ownerSessionId,
      fromSeq ?? 0,
      10_000,
    );
    for (const e of events) {
      if (!isReplayableForJob(e, job.jobId)) continue;
      await forwardEventToSubscriber(ctx, e);
    }
    return events.some((e) => e.job_id === job.jobId);
  } catch (error) {
    ctx.logger.warn({ err: error }, "subscribe history replay failed");
    return false;
  }
}

function isReplayableForJob(env: BaseEnvelope, jobId: JobId): boolean {
  if (env.job_id !== jobId) return false;
  return (
    env.type === "job.event" ||
    env.type === "job.result" ||
    env.type === "job.error"
  );
}

function buildSubscribedPayload(
  job: Job,
  subscribedFrom: number,
  replayed: boolean,
): Record<string, unknown> {
  return {
    job_id: job.jobId,
    current_status: job.state,
    agent: job.agentRef,
    lease: job.lease,
    ...(job.leaseConstraints === undefined
      ? {}
      : { lease_constraints: job.leaseConstraints }),
    parent_job_id: job.parentJobId ?? null,
    ...(job.traceId === undefined ? {} : { trace_id: job.traceId }),
    subscribed_from: subscribedFrom,
    replayed,
  };
}
