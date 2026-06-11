import {
  JOB_STATES,
  type JobListEntry,
  parseAgentRef,
  type SessionListJobsFilter,
} from "@agentruntimecontrolprotocol/core/messages";

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

/**
 * Stable list ordering: `created_at` ascending, then `job_id` for determinism.
 * The pagination cursor (§6.6) encodes this same key so paging stays correct
 * even when the previous page's last job has completed and been removed from
 * `globalJobs` between calls (issue #144).
 */
interface JobSortKey {
  createdAt: string;
  jobId: string;
}

function sortKeyOf(job: Job): JobSortKey {
  return { createdAt: job.createdAt, jobId: job.jobId };
}

/** Compare two jobs by the stable list key (created_at, then job_id). */
function compareJobs(a: Job, b: Job): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  return a.jobId.localeCompare(b.jobId);
}

/** Whether `job` sorts strictly after the cursor key by the list ordering. */
function jobAfterCursor(job: Job, cursor: JobSortKey): boolean {
  const tj = Date.parse(job.createdAt);
  const tc = Date.parse(cursor.createdAt);
  if (tj !== tc) return tj > tc;
  return job.jobId.localeCompare(cursor.jobId) > 0;
}

/** Encode the (created_at, job_id) sort key as an opaque pagination cursor. */
export function encodeJobCursor(key: JobSortKey): string {
  return Buffer.from(`${key.createdAt}\u0000${key.jobId}`, "utf8").toString(
    "base64url",
  );
}

/** Decode an opaque cursor back to its sort key, or `null` if malformed. */
export function decodeJobCursor(cursor: string | undefined): JobSortKey | null {
  if (cursor === undefined || cursor === "") return null;
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const idx = raw.indexOf("\u0000");
  if (idx === -1) return null;
  return { createdAt: raw.slice(0, idx), jobId: raw.slice(idx + 1) };
}

function jobToListEntry(job: Job): JobListEntry {
  return {
    job_id: job.jobId,
    agent: job.agentRef,
    status: job.state,
    lease: job.lease,
    parent_job_id: job.parentJobId ?? null,
    created_at: job.createdAt,
    ...(job.traceId === undefined ? {} : { trace_id: job.traceId }),
    last_event_seq: job.lastEventSeq,
  };
}

export interface PaginatedJobList {
  page: JobListEntry[];
  nextCursor: string | null;
}

export interface SelectJobPageArgs {
  jobs: Iterable<Job>;
  authorize: (job: Job) => boolean;
  filter: ListJobsFilter;
  cursor: string | undefined;
  limit: number;
}

/**
 * Keyset pagination over the live job set (§6.6).
 *
 * Iterates `jobs` once and keeps only the smallest `limit + 1` authorized,
 * filtered jobs whose sort key is strictly greater than the cursor. Because the
 * selection is bounded, a small page never sorts or materializes the entire
 * authorized set — `limit` bounds the runtime work, not just the response
 * (issue #134). The cursor encodes the stable (created_at, job_id) key, so
 * paging is robust to the previous page's last job having been removed between
 * calls (issue #144).
 */
export function selectJobPage(args: SelectJobPageArgs): PaginatedJobList {
  const limit =
    Number.isFinite(args.limit) && args.limit > 0 ? args.limit : 100;
  const selected = collectBoundedJobs(args, decodeJobCursor(args.cursor), limit);
  const hasMore = selected.length > limit;
  const pageJobs = hasMore ? selected.slice(0, limit) : selected;
  const last = pageJobs.at(-1);
  return {
    page: pageJobs.map(jobToListEntry),
    nextCursor:
      hasMore && last !== undefined ? encodeJobCursor(sortKeyOf(last)) : null,
  };
}

/**
 * Scan `jobs` once, keeping only the smallest `limit + 1` authorized, filtered
 * jobs whose sort key is strictly greater than the cursor.
 */
function collectBoundedJobs(
  args: SelectJobPageArgs,
  cursor: JobSortKey | null,
  limit: number,
): Job[] {
  const { jobs, authorize, filter } = args;
  const capacity = limit + 1;
  const selected: Job[] = [];
  for (const job of jobs) {
    if (!authorize(job)) continue;
    if (!filter.matches(job)) continue;
    if (cursor !== null && !jobAfterCursor(job, cursor)) continue;
    insertBounded(selected, job, capacity);
  }
  return selected;
}

/**
 * Insert `job` into the ascending-sorted `sorted` array, keeping at most
 * `capacity` entries (the smallest ones). Jobs beyond the bounded window are
 * dropped without growing the array.
 */
function insertBounded(sorted: Job[], job: Job, capacity: number): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const atMid = sorted[mid];
    if (atMid !== undefined && compareJobs(atMid, job) <= 0) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= capacity) return;
  sorted.splice(lo, 0, job);
  if (sorted.length > capacity) sorted.pop();
}
