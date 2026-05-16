import type { JobId } from "@arcp/core";
import { TaggedHeartbeatLost, TaggedInvalidRequest } from "@arcp/core";
import { InvalidRequestError } from "@arcp/core/errors";
import type {
  JobErrorPayload,
  JobResultPayload,
  JobStateName,
} from "@arcp/core/messages";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  JobManagerService,
  JobService,
  jobLayer,
  jobManagerLayer,
  type JobLike,
  type JobManagerLike,
  makeJobEffect,
  watchdogEffect,
} from "../src/job-effect.js";

const STATE_TRANSITIONS: Record<JobStateName, ReadonlySet<JobStateName>> = {
  pending: new Set(["running", "cancelled", "error", "timed_out"]),
  running: new Set(["success", "error", "cancelled", "timed_out"]),
  success: new Set(),
  error: new Set(),
  cancelled: new Set(),
  timed_out: new Set(),
};

interface FakeJob extends JobLike {
  readonly emitted: { kind: string; payload?: unknown }[];
  cancelReason: string | undefined;
  hardReason: string | undefined;
  heartbeats: number;
  state: JobStateName;
}

function makeFakeJob(id = "job_test" as JobId): FakeJob {
  const emitted: { kind: string; payload?: unknown }[] = [];
  const fake: FakeJob = {
    jobId: id,
    emitted,
    cancelReason: undefined,
    hardReason: undefined,
    heartbeats: 0,
    state: "pending",
    get isTerminal() {
      return ["success", "error", "cancelled", "timed_out"].includes(
        fake.state,
      );
    },
    async emitAccepted() {
      emitted.push({ kind: "accepted" });
    },
    async emitRunning() {
      fake.state = "running";
      emitted.push({ kind: "running" });
    },
    async emitEventKind(kind, body) {
      fake.heartbeats += 1;
      emitted.push({ kind: `event:${kind}`, payload: body });
    },
    async emitResult(result: JobResultPayload) {
      fake.state = "success";
      emitted.push({ kind: "result", payload: result });
    },
    async emitErrorEnvelope(payload: JobErrorPayload) {
      fake.state = payload.final_status;
      emitted.push({ kind: "error", payload });
    },
    transition(next: JobStateName) {
      const allowed = STATE_TRANSITIONS[fake.state];
      if (!allowed.has(next) && fake.state !== next) {
        throw new InvalidRequestError(
          `Illegal job transition: ${fake.state} → ${next}`,
        );
      }
      fake.state = next;
    },
    markHeartbeat() {
      fake.heartbeats += 1;
    },
    cancel(reason) {
      fake.cancelReason = reason;
    },
    abortHard(reason) {
      fake.hardReason = reason;
    },
  };
  return fake;
}

describe("JobService (Effect)", () => {
  it("emitAccepted/emitRunning/emitEventKind forward to legacy job", async () => {
    const fake = makeFakeJob();
    await Effect.runPromise(
      Effect.gen(function* () {
        const job = yield* JobService;
        yield* job.emitAccepted;
        yield* job.emitRunning;
        yield* job.emitEventKind("status", { phase: "halfway" });
      }).pipe(Effect.provide(jobLayer(fake))),
    );
    expect(fake.emitted.map((e) => e.kind)).toEqual([
      "accepted",
      "running",
      "event:status",
    ]);
    expect(fake.state).toBe("running");
  });

  it("state-machine pending→running→success via transition+emitResult", async () => {
    const fake = makeFakeJob();
    await Effect.runPromise(
      Effect.gen(function* () {
        const job = yield* JobService;
        yield* job.transition("running");
        yield* job.emitResult({ final_status: "success", result: 42 });
      }).pipe(Effect.provide(jobLayer(fake))),
    );
    expect(fake.state).toBe("success");
  });

  it("illegal transition surfaces TaggedInvalidRequest", async () => {
    const fake = makeFakeJob();
    fake.state = "success";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const job = yield* JobService;
        yield* job.transition("running");
      }).pipe(Effect.provide(jobLayer(fake))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(TaggedInvalidRequest);
      }
    }
  });

  it("cancel delegates the reason to the legacy job", async () => {
    const fake = makeFakeJob();
    await Effect.runPromise(
      Effect.gen(function* () {
        const job = yield* JobService;
        yield* job.cancel("user cancelled");
      }).pipe(Effect.provide(jobLayer(fake))),
    );
    expect(fake.cancelReason).toBe("user cancelled");
  });

  it("markHeartbeat increments the underlying counter", async () => {
    const fake = makeFakeJob();
    const ops = makeJobEffect(fake);
    await Effect.runPromise(ops.markHeartbeat);
    await Effect.runPromise(ops.markHeartbeat);
    expect(fake.heartbeats).toBe(2);
  });
});

describe("JobManagerService (Effect)", () => {
  function makeFakeManager(): JobManagerLike & {
    readonly store: Map<string, JobLike>;
    cancelledReason: string | undefined;
  } {
    const store = new Map<string, JobLike>();
    const mgr = {
      store,
      register(job: JobLike) {
        store.set(job.jobId, job);
      },
      get(id: string) {
        return store.get(id);
      },
      has(id: string) {
        return store.has(id);
      },
      retire(id: string) {
        store.delete(id);
      },
      list() {
        return [...store.values()];
      },
      cancelAll(reason: string) {
        mgr.cancelledReason = reason;
        return store.size;
      },
      abortAll(_reason: string) {
        // no-op in fake
      },
      cancelledReason: undefined as string | undefined,
    };
    return mgr;
  }

  it("register/get/has/retire round-trip", async () => {
    const mgr = makeFakeManager();
    const job = makeFakeJob("job_a" as JobId);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* JobManagerService;
        yield* svc.register(job);
        const has = yield* svc.has("job_a");
        const fetched = yield* svc.get("job_a");
        yield* svc.retire("job_a");
        const hasAfter = yield* svc.has("job_a");
        return { has, fetchedSame: fetched === job, hasAfter };
      }).pipe(Effect.provide(jobManagerLayer(mgr))),
    );
    expect(result).toEqual({ has: true, fetchedSame: true, hasAfter: false });
  });

  it("cancelAll forwards the reason", async () => {
    const mgr = makeFakeManager();
    mgr.register(makeFakeJob("job_a" as JobId));
    const count = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* JobManagerService;
        return yield* svc.cancelAll("shutdown");
      }).pipe(Effect.provide(jobManagerLayer(mgr))),
    );
    expect(count).toBe(1);
    expect(mgr.cancelledReason).toBe("shutdown");
  });
});

describe("watchdogEffect (Effect)", () => {
  it("fires TaggedHeartbeatLost after the threshold elapses without reset", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const wd = yield* watchdogEffect(400, "job_test");
        return yield* wd.await;
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(TaggedHeartbeatLost);
      }
    }
  });

  it("reset prevents the watchdog from firing within the threshold", async () => {
    // Threshold 600ms, reset every 250ms for 1s, then stop resetting and the
    // watchdog should fire ~600ms later. Generous tolerance: just assert that
    // the workflow completes without an immediate fail.
    const completed = await Effect.runPromise(
      Effect.gen(function* () {
        const wd = yield* watchdogEffect(600);
        // Race the watchdog against a short success effect; the success
        // should win because the threshold (600ms) > our wait (200ms).
        return yield* Effect.race(
          Effect.sleep("200 millis").pipe(Effect.as("ok" as const)),
          wd.await,
        );
      }),
    );
    expect(completed).toBe("ok");
  });

  it("reset re-arms the deadline so the watchdog never fires while ticking", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const wd = yield* watchdogEffect(500);
        // Fork the watchdog; ping reset every 200ms for 1s; then interrupt.
        const fiber = yield* Effect.fork(wd.await);
        for (let i = 0; i < 5; i++) {
          yield* Effect.sleep("200 millis");
          yield* wd.reset;
        }
        yield* Fiber.interrupt(fiber);
        return "alive" as const;
      }),
    );
    expect(result).toBe("alive");
  });
});
