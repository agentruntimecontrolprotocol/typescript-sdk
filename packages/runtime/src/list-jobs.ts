import {
  JOB_STATES,
  type JobListEntry,
  parseAgentRef,
  type SessionListJobsFilter,
} from "@arcp/core/messages";

import type { Job } from "./job.js";

export interface ListJobsFilter {
  matches(job: Job): boolean;
}

export function compileListJobsFilter(
  filter: SessionListJobsFilter,
): ListJobsFilter {
  const allowedStatuses = new Set<string>(filter.status ?? JOB_STATES);
  const createdAfter = filter.created_after
    ? Date.parse(filter.created_after)
    : null;
  const createdBefore = filter.created_before
    ? Date.parse(filter.created_before)
    : null;
  const agentMatcher =
    filter.agent === undefined ? null : buildAgentMatcher(filter.agent);
  return {
    matches(job) {
      if (!allowedStatuses.has(job.state)) return false;
      if (agentMatcher !== null && !agentMatcher(job)) return false;
      if (!matchesCreatedAfter(job, createdAfter)) return false;
      if (!matchesCreatedBefore(job, createdBefore)) return false;
      return true;
    },
  };
}

function buildAgentMatcher(agent: string): (job: Job) => boolean {
  const parsed = parseAgentRef(agent);
  if (parsed.version === null) {
    return (job) => job.agent === parsed.name;
  }
  return (job) =>
    job.agent === parsed.name && job.agentVersion === parsed.version;
}

function matchesCreatedAfter(job: Job, threshold: number | null): boolean {
  if (threshold === null) return true;
  const t = Date.parse(job.createdAt);
  return Number.isFinite(t) && t > threshold;
}

function matchesCreatedBefore(job: Job, threshold: number | null): boolean {
  if (threshold === null) return true;
  const t = Date.parse(job.createdAt);
  return Number.isFinite(t) && t < threshold;
}

export function compareJobListEntries(
  a: JobListEntry,
  b: JobListEntry,
): number {
  // Sort by created_at ascending, then by job_id for determinism.
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (ta !== tb) return ta - tb;
  return a.job_id.localeCompare(b.job_id);
}

export interface PaginatedJobList {
  page: JobListEntry[];
  nextCursor: string | null;
}

export function paginateJobList(
  candidates: JobListEntry[],
  cursor: string | undefined,
  limit: number,
): PaginatedJobList {
  // Cursor: opaque ULID of the last-emitted job_id in the previous page.
  let startIdx = 0;
  if (cursor !== undefined && cursor !== "") {
    const idx = candidates.findIndex((c) => c.job_id === cursor);
    if (idx !== -1) startIdx = idx + 1;
  }
  const page = candidates.slice(startIdx, startIdx + limit);
  const lastEntry = page.length > 0 ? page.at(-1) : undefined;
  const nextCursor =
    startIdx + limit < candidates.length && lastEntry !== undefined
      ? lastEntry.job_id
      : null;
  return { page, nextCursor };
}
