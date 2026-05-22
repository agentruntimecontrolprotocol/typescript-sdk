import { Effect, Fiber, Ref } from "effect";
import { describe, expect, it } from "vitest";

import {
  combineSignals,
  getOrCreate,
  getOrCreateEffect,
  IdGen,
  safeSetInterval,
  safeSetTimeout,
  setIntervalEffect,
  setTimeoutEffect,
  signalToInterruption,
} from "@agentruntimecontrolprotocol/core";

describe("combineSignals", () => {
  it("returns a fresh signal when given no inputs", () => {
    const sig = combineSignals();
    expect(sig.aborted).toBe(false);
  });

  it("returns the single input as-is", () => {
    const ctrl = new AbortController();
    const sig = combineSignals(ctrl.signal);
    expect(sig).toBe(ctrl.signal);
  });

  it("aborts when any input aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineSignals(a.signal, b.signal);
    expect(combined.aborted).toBe(false);
    a.abort("first");
    expect(combined.aborted).toBe(true);
  });

  it("propagates the reason", () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineSignals(a.signal, b.signal);
    a.abort("first-reason");
    expect(combined.reason).toBe("first-reason");
  });

  it("if any input is already aborted, result is aborted", () => {
    const a = new AbortController();
    a.abort("pre");
    const b = new AbortController();
    const combined = combineSignals(a.signal, b.signal);
    expect(combined.aborted).toBe(true);
  });
});

describe("safeSetTimeout / safeSetInterval", () => {
  it("safeSetTimeout fires after delay and is cancellable", async () => {
    let fired = 0;
    const cancel = safeSetTimeout(() => {
      fired += 1;
    }, 5);
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(fired).toBe(1);
    cancel(); // no-op after fire
  });

  it("safeSetTimeout cancellation prevents firing", async () => {
    let fired = 0;
    const cancel = safeSetTimeout(() => {
      fired += 1;
    }, 50);
    cancel();
    await new Promise<void>((r) => setTimeout(r, 80));
    expect(fired).toBe(0);
  });

  it("safeSetInterval fires repeatedly until cancelled", async () => {
    let fired = 0;
    const cancel = safeSetInterval(() => {
      fired += 1;
    }, 5);
    await new Promise<void>((r) => setTimeout(r, 30));
    cancel();
    const snapshot = fired;
    expect(snapshot).toBeGreaterThanOrEqual(2);
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(fired).toBe(snapshot);
  });
});

describe("setTimeoutEffect / setIntervalEffect", () => {
  it("setTimeoutEffect resolves after the duration elapses", async () => {
    const started = Date.now();
    await Effect.runPromise(setTimeoutEffect(20));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });

  it("setIntervalEffect runs the action repeatedly and stops on interrupt", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* Ref.make(0);
      const tick = Ref.update(counter, (n) => n + 1);
      const fiber = yield* Effect.fork(setIntervalEffect(tick, 5));
      yield* Effect.sleep(30);
      yield* Fiber.interrupt(fiber);
      return yield* counter;
    });
    const ticks = await Effect.runPromise(program);
    expect(ticks).toBeGreaterThanOrEqual(2);
  });
});

describe("signalToInterruption", () => {
  it("interrupts the fiber when the signal aborts", async () => {
    const ctrl = new AbortController();
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(signalToInterruption(ctrl.signal));
      yield* Effect.sleep(5);
      ctrl.abort();
      const exit = yield* Fiber.await(fiber);
      return exit._tag;
    });
    const tag = await Effect.runPromise(program);
    expect(tag).toBe("Failure");
  });

  it("interrupts immediately when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(signalToInterruption(ctrl.signal));
      const exit = yield* Fiber.await(fiber);
      return exit._tag;
    });
    const tag = await Effect.runPromise(program);
    expect(tag).toBe("Failure");
  });
});

describe("getOrCreate / getOrCreateEffect", () => {
  it("getOrCreate returns existing value without calling factory", () => {
    const map = new Map<string, number>([["a", 1]]);
    let calls = 0;
    const v = getOrCreate(map, "a", () => {
      calls += 1;
      return 99;
    });
    expect(v).toBe(1);
    expect(calls).toBe(0);
  });

  it("getOrCreate inserts and returns the new value when missing", () => {
    const map = new Map<string, number>();
    const v = getOrCreate(map, "b", () => 42);
    expect(v).toBe(42);
    expect(map.get("b")).toBe(42);
  });

  it("getOrCreateEffect populates the underlying map on miss", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make(new Map<string, string>());
      const first = yield* getOrCreateEffect(ref, "k", Effect.succeed("v1"));
      const second = yield* getOrCreateEffect(
        ref,
        "k",
        Effect.sync(() => "v2-should-not-run"),
      );
      const map = yield* ref;
      return { first, second, size: map.size };
    });
    const result = await Effect.runPromise(program);
    expect(result.first).toBe("v1");
    expect(result.second).toBe("v1");
    expect(result.size).toBe(1);
  });
});

describe("IdGen service", () => {
  it("produces monotonically increasing ULIDs via next", async () => {
    const program = Effect.gen(function* () {
      const gen = yield* IdGen;
      const a = yield* gen.next;
      const b = yield* gen.next;
      return { a, b };
    }).pipe(Effect.provide(IdGen.Default));
    const { a, b } = await Effect.runPromise(program);
    expect(typeof a).toBe("string");
    expect(a.length).toBe(26);
    expect(b > a).toBe(true);
  });

  it("prefixed prepends the requested prefix", async () => {
    const program = Effect.gen(function* () {
      const gen = yield* IdGen;
      return yield* gen.prefixed("test");
    }).pipe(Effect.provide(IdGen.Default));
    const id = await Effect.runPromise(program);
    expect(id.startsWith("test_")).toBe(true);
    expect(id.length).toBe(31);
  });
});
