import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  CancelledError,
  type MessageId,
  PendingRegistry,
  PendingRegistryService,
  TaggedCancelled,
  TaggedInternal,
  TaggedTimeout,
  TimeoutError,
} from "@arcp/core";

describe("PendingRegistry", () => {
  it("starts empty", () => {
    const r = new PendingRegistry();
    expect(r.size).toBe(0);
  });

  it("registers, resolves, and reports size", async () => {
    const r = new PendingRegistry();
    const promise = r.register<number>("c1");
    expect(r.size).toBe(1);
    expect(r.resolve("c1", 42)).toBe(true);
    expect(await promise).toBe(42);
    expect(r.size).toBe(0);
  });

  it("rejects via reject()", async () => {
    const r = new PendingRegistry();
    const promise = r.register<number>("c1");
    expect(r.reject("c1", new Error("boom"))).toBe(true);
    await expect(promise).rejects.toThrow("boom");
  });

  it("cancel() rejects with CancelledError", async () => {
    const r = new PendingRegistry();
    const promise = r.register<unknown>("c1");
    expect(r.cancel("c1", "user")).toBe(true);
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
  });

  it("resolve/reject return false on missing entries", () => {
    const r = new PendingRegistry();
    expect(r.resolve("nope", 1)).toBe(false);
    expect(r.reject("nope", new Error("test"))).toBe(false);
    expect(r.cancel("nope")).toBe(false);
  });

  it("rejects duplicate registration", () => {
    const r = new PendingRegistry();
    void r.register("c1");
    expect(() => r.register("c1")).toThrow();
  });

  it("expires registered entries after deadline", async () => {
    const r = new PendingRegistry();
    const promise = r.register<unknown>("c1", { deadlineMs: 5 });
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
  });

  it("AbortSignal aborts pending entries", async () => {
    const r = new PendingRegistry();
    const ctrl = new AbortController();
    const promise = r.register<unknown>("c1", { signal: ctrl.signal });
    ctrl.abort("user-abort");
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
  });

  it("pre-aborted signal rejects immediately", async () => {
    const r = new PendingRegistry();
    const ctrl = new AbortController();
    ctrl.abort();
    const promise = r.register<unknown>("c1", { signal: ctrl.signal });
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
  });

  it("rejectAll clears every entry with the same reason", async () => {
    const r = new PendingRegistry();
    const a = r.register<unknown>("a");
    const b = r.register<unknown>("b");
    r.rejectAll(new Error("shutdown"));
    await expect(a).rejects.toThrow("shutdown");
    await expect(b).rejects.toThrow("shutdown");
    expect(r.size).toBe(0);
  });
});

describe("PendingRegistryService (Effect)", () => {
  it("register → resolve → await round-trips a value", async () => {
    const id = "msg_1" as MessageId;
    const program = Effect.gen(function* () {
      const reg = yield* PendingRegistryService;
      const wait = yield* reg.register<number>(id);
      yield* reg.resolve(id, 42);
      const got = yield* wait;
      const size = yield* reg.size;
      return { got, size };
    }).pipe(Effect.provide(PendingRegistryService.Default));
    const out = await Effect.runPromise(program);
    expect(out.got).toBe(42);
    expect(out.size).toBe(0);
  });

  it("round-trip cleanup: register → cancel → resolve returns false", async () => {
    const id = "msg_cancel" as MessageId;
    const program = Effect.gen(function* () {
      const reg = yield* PendingRegistryService;
      const wait = yield* reg.register<number>(id);
      yield* reg.cancel(id, "user");
      const exit = yield* Effect.exit(wait);
      const stillThere = yield* reg.resolve(id, 1);
      const size = yield* reg.size;
      return { exit, stillThere, size };
    }).pipe(Effect.provide(PendingRegistryService.Default));
    const out = await Effect.runPromise(program);
    expect(out.exit._tag).toBe("Failure");
    if (out.exit._tag === "Failure") {
      const err =
        out.exit.cause._tag === "Fail" ? out.exit.cause.error : undefined;
      expect(err).toBeInstanceOf(TaggedCancelled);
    }
    expect(out.stillThere).toBe(false);
    expect(out.size).toBe(0);
  });

  it("expires entries past the deadline with TaggedTimeout", async () => {
    const id = "msg_timeout" as MessageId;
    const program = Effect.gen(function* () {
      const reg = yield* PendingRegistryService;
      const wait = yield* reg.register<number>(id, { deadlineMs: 5 });
      return yield* Effect.exit(wait);
    }).pipe(Effect.provide(PendingRegistryService.Default));
    const exit = await Effect.runPromise(program);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
      expect(err).toBeInstanceOf(TaggedTimeout);
    }
  });

  it("100 concurrent registers for distinct keys are all visible", async () => {
    const N = 100;
    const program = Effect.gen(function* () {
      const reg = yield* PendingRegistryService;
      const waiters = yield* Effect.all(
        Array.from({ length: N }, (_, i) =>
          reg.register<number>(`msg_${i}`),
        ),
        { concurrency: "unbounded" },
      );
      const size = yield* reg.size;
      // resolve them all so nothing leaks; the waiters themselves prove
      // round-trip semantics.
      yield* Effect.all(
        Array.from({ length: N }, (_, i) =>
          reg.resolve(`msg_${i}`, i),
        ),
        { concurrency: "unbounded" },
      );
      const resolved = yield* Effect.all(waiters, { concurrency: "unbounded" });
      const finalSize = yield* reg.size;
      return { size, resolved, finalSize };
    }).pipe(Effect.provide(PendingRegistryService.Default));
    const out = await Effect.runPromise(program);
    expect(out.size).toBe(N);
    expect(out.finalSize).toBe(0);
    expect(out.resolved).toEqual(Array.from({ length: N }, (_, i) => i));
  });

  it("10 concurrent registers for the same key: exactly one wins", async () => {
    const N = 10;
    const id = "msg_conflict" as MessageId;
    const program = Effect.gen(function* () {
      const reg = yield* PendingRegistryService;
      const outcomes = yield* Effect.all(
        Array.from({ length: N }, () =>
          Effect.exit(reg.register<number>(id)),
        ),
        { concurrency: "unbounded" },
      );
      const size = yield* reg.size;
      return { outcomes, size };
    }).pipe(Effect.provide(PendingRegistryService.Default));
    const out = await Effect.runPromise(program);
    const successes = out.outcomes.filter((e) => e._tag === "Success").length;
    const failures = out.outcomes.filter((e) => e._tag === "Failure");
    expect(successes).toBe(1);
    expect(failures.length).toBe(N - 1);
    for (const f of failures) {
      if (f._tag === "Failure") {
        const err = f.cause._tag === "Fail" ? f.cause.error : undefined;
        expect(err).toBeInstanceOf(TaggedInternal);
      }
    }
    expect(out.size).toBe(1);
  });

  it("registerMeta + peekMeta round-trip", async () => {
    const id = "msg_meta" as MessageId;
    const program = Effect.gen(function* () {
      const reg = yield* PendingRegistryService;
      yield* reg.register<number>(id);
      yield* reg.registerMeta(id, { kind: "test" });
      const m = yield* reg.peekMeta(id);
      yield* reg.resolve(id, 0);
      const after = yield* reg.peekMeta(id);
      return { m, after };
    }).pipe(Effect.provide(PendingRegistryService.Default));
    const out = await Effect.runPromise(program);
    expect(out.m).toEqual({ kind: "test" });
    expect(out.after).toBeUndefined();
  });
});
