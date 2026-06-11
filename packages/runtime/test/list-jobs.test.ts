import { describe, expect, it } from "vitest";

import type { Job } from "../src/job.js";
import { decodeJobCursor, selectJobPage } from "../src/list-jobs.js";

// Minimal Job stand-in carrying only the fields selectJobPage / jobToListEntry
// read. createdAt and jobId both increase with `i`, so sort order == index.
function fakeJob(i: number): Job {
  const seq = String(i).padStart(4, "0");
  return {
    jobId: `job_${seq}`,
    createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    agentRef: "agent",
    state: "running",
    lease: {},
    parentJobId: undefined,
    traceId: undefined,
    lastEventSeq: 0,
  } as unknown as Job;
}

const ALLOW_ALL = { matches: () => true };
const authorizeAll = (): boolean => true;

describe("selectJobPage pagination (§6.6)", () => {
  it("continues paging when the cursor job has been removed (issue #144)", () => {
    const jobs = new Map<string, Job>();
    for (let i = 0; i < 5; i += 1) {
      const j = fakeJob(i);
      jobs.set(j.jobId, j);
    }
    const page1 = selectJobPage({
      jobs: jobs.values(),
      authorize: authorizeAll,
      filter: ALLOW_ALL,
      cursor: undefined,
      limit: 2,
    });
    expect(page1.page.map((e) => e.job_id)).toEqual(["job_0000", "job_0001"]);
    expect(page1.nextCursor).not.toBeNull();

    // The cursor job (last entry of page 1) completes and is removed before
    // the next page is requested — the old job_id-only cursor restarted at
    // page 1 here; the keyset cursor must advance past it instead.
    jobs.delete("job_0001");
    const page2 = selectJobPage({
      jobs: jobs.values(),
      authorize: authorizeAll,
      filter: ALLOW_ALL,
      cursor: page1.nextCursor ?? undefined,
      limit: 2,
    });
    expect(page2.page.map((e) => e.job_id)).toEqual(["job_0002", "job_0003"]);
  });

  it("nextCursor encodes the stable (created_at, job_id) key", () => {
    const jobs = [fakeJob(0), fakeJob(1), fakeJob(2)];
    const page1 = selectJobPage({
      jobs,
      authorize: authorizeAll,
      filter: ALLOW_ALL,
      cursor: undefined,
      limit: 2,
    });
    const key = decodeJobCursor(page1.nextCursor ?? undefined);
    expect(key).toEqual({
      createdAt: jobs[1]?.createdAt,
      jobId: "job_0001",
    });
  });

  it("pages through many jobs with a small limit without dupes or gaps (issue #134)", () => {
    const N = 1000;
    const jobs = new Map<string, Job>();
    for (let i = 0; i < N; i += 1) {
      const j = fakeJob(i);
      jobs.set(j.jobId, j);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard <= N; guard += 1) {
      const res = selectJobPage({
        jobs: jobs.values(),
        authorize: authorizeAll,
        filter: ALLOW_ALL,
        cursor,
        limit: 10,
      });
      // The page is bounded by `limit`, regardless of the total job count.
      expect(res.page.length).toBeLessThanOrEqual(10);
      for (const e of res.page) seen.push(e.job_id);
      if (res.nextCursor === null) break;
      cursor = res.nextCursor;
    }
    expect(seen).toHaveLength(N);
    expect(new Set(seen).size).toBe(N);
    // Strictly ascending by the stable key across all pages.
    expect(seen).toEqual([...seen].sort());
  });

  it("returns null nextCursor on the final page", () => {
    const jobs = [fakeJob(0), fakeJob(1)];
    const res = selectJobPage({
      jobs,
      authorize: authorizeAll,
      filter: ALLOW_ALL,
      cursor: undefined,
      limit: 10,
    });
    expect(res.page).toHaveLength(2);
    expect(res.nextCursor).toBeNull();
  });
});
