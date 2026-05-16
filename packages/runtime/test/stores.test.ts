import { TaggedResumeWindowExpired } from "@arcp/core";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  IdempotencyStore,
  IdempotencyStoreService,
  type IdempotencyEntry,
  idempotencyKey,
  newResumeToken,
  ResumeStore,
  ResumeStoreService,
  type ResumeRecord,
} from "../src/stores.js";

const FUTURE = Date.now() + 60_000;

function entry(jobId: string, overrides: Partial<IdempotencyEntry> = {}): IdempotencyEntry {
  return {
    jobId: jobId,
    agent: "echo",
    inputDigest: "{}",
    expiresAt: FUTURE,
    ...overrides,
  };
}

describe("idempotencyKey", () => {
  it("matches the legacy job-runner composition", () => {
    expect(idempotencyKey("alice", "key-1")).toBe("alice::key-1");
  });
});

describe("IdempotencyStoreService — race resolution (#26)", () => {
  it("100 fibers racing the same (principal, key) all see the same canonical jobId", async () => {
    const program = Effect.gen(function* () {
      const store = yield* IdempotencyStoreService;
      const fresh = (i: number) => entry(`job-${i}`);
      const results = yield* Effect.all(
        Array.from({ length: 100 }, (_, i) =>
          store.checkAndStore("alice", "shared-key", fresh(i)),
        ),
        { concurrency: "unbounded" },
      );
      const snapshot = yield* store.snapshot;
      return { results, snapshot } as const;
    }).pipe(Effect.provide(IdempotencyStoreService.Default));

    const { results, snapshot } = await Effect.runPromise(program);
    const canonical = results[0]?.jobId;
    expect(canonical).toBeDefined();
    for (const r of results) {
      expect(r.jobId).toBe(canonical);
    }
    expect(snapshot.size).toBe(1);
    expect(snapshot.get("alice::shared-key")?.jobId).toBe(canonical);
  });

  it("100 distinct keys fan out to 100 independent entries", async () => {
    const program = Effect.gen(function* () {
      const store = yield* IdempotencyStoreService;
      const results = yield* Effect.all(
        Array.from({ length: 100 }, (_, i) =>
          store.checkAndStore("alice", `key-${i}`, entry(`job-${i}`)),
        ),
        { concurrency: "unbounded" },
      );
      const snapshot = yield* store.snapshot;
      return { results, snapshot } as const;
    }).pipe(Effect.provide(IdempotencyStoreService.Default));

    const { results, snapshot } = await Effect.runPromise(program);
    expect(snapshot.size).toBe(100);
    const jobIds = new Set(results.map((r) => r.jobId));
    expect(jobIds.size).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(snapshot.get(`alice::key-${i}`)?.jobId).toBe(`job-${i}`);
    }
  });

  it("checkAndStore treats expired entries as absent", async () => {
    const program = Effect.gen(function* () {
      const store = yield* IdempotencyStoreService;
      const stale = entry("old", { expiresAt: Date.now() - 1000 });
      const fresh = entry("new");
      yield* store.set("alice", "k", stale);
      const result = yield* store.checkAndStore("alice", "k", fresh);
      return result;
    }).pipe(Effect.provide(IdempotencyStoreService.Default));

    const result = await Effect.runPromise(program);
    expect(result.jobId).toBe("new");
  });
});

describe("ResumeStoreService", () => {
  const record: ResumeRecord = {
    sessionId: "s-1",
    resumeToken: "rt_xxx",
    expiresAt: FUTURE,
  };

  it("store + consume returns the record exactly once", async () => {
    const program = Effect.gen(function* () {
      const store = yield* ResumeStoreService;
      yield* store.store("s-1", record);
      const first = yield* store.consume("s-1");
      const secondExit = yield* Effect.exit(store.consume("s-1"));
      return { first, secondExit } as const;
    }).pipe(Effect.provide(ResumeStoreService.Default));

    const { first, secondExit } = await Effect.runPromise(program);
    expect(first).toEqual(record);
    expect(Exit.isFailure(secondExit)).toBe(true);
    if (Exit.isFailure(secondExit)) {
      const err = secondExit.cause;
      expect(String(err)).toMatch(/ResumeWindowExpired|No resume record/);
    }
  });

  it("consume on expired entry fails with TaggedResumeWindowExpired and evicts", async () => {
    const program = Effect.gen(function* () {
      const store = yield* ResumeStoreService;
      const stale: ResumeRecord = {
        sessionId: "s-2",
        resumeToken: "rt_old",
        expiresAt: Date.now() - 1000,
      };
      yield* store.store("s-2", stale);
      const exit = yield* Effect.exit(store.consume("s-2"));
      const after = yield* store.get("s-2");
      return { exit, after } as const;
    }).pipe(Effect.provide(ResumeStoreService.Default));

    const { exit, after } = await Effect.runPromise(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      expect(exit.cause.error).toBeInstanceOf(TaggedResumeWindowExpired);
    }
    expect(after).toBeUndefined();
  });

  it("sweep drops only entries past the cutoff", async () => {
    const program = Effect.gen(function* () {
      const store = yield* ResumeStoreService;
      const cutoff = 1000;
      yield* store.store("old", {
        sessionId: "old",
        resumeToken: "a",
        expiresAt: 500,
      });
      yield* store.store("edge", {
        sessionId: "edge",
        resumeToken: "b",
        expiresAt: 1000,
      });
      yield* store.store("live", {
        sessionId: "live",
        resumeToken: "c",
        expiresAt: 5000,
      });
      yield* store.sweep(cutoff);
      return yield* store.snapshot;
    }).pipe(Effect.provide(ResumeStoreService.Default));

    const snapshot = await Effect.runPromise(program);
    expect(snapshot.has("old")).toBe(false);
    expect(snapshot.has("edge")).toBe(false);
    expect(snapshot.has("live")).toBe(true);
  });
});

describe("legacy classes — behavior preservation smoke", () => {
  it("IdempotencyStore get/set/sweep still works", () => {
    const store = new IdempotencyStore();
    const e = entry("j-1", { expiresAt: 100 });
    store.set("k", e);
    expect(store.get("k")).toBe(e);
    store.sweep(200);
    expect(store.get("k")).toBeUndefined();
  });

  it("ResumeStore get/set/delete/sweep still works", () => {
    const store = new ResumeStore();
    const rec: ResumeRecord = {
      sessionId: "s",
      resumeToken: "t",
      expiresAt: 100,
    };
    store.set("s", rec);
    expect(store.get("s")).toBe(rec);
    store.delete("s");
    expect(store.get("s")).toBeUndefined();
    store.set("s", rec);
    store.sweep(200);
    expect(store.get("s")).toBeUndefined();
  });

  it("newResumeToken returns a prefixed token", () => {
    const t = newResumeToken();
    expect(t.startsWith("rt_")).toBe(true);
    expect(t.length).toBeGreaterThan(10);
  });
});
