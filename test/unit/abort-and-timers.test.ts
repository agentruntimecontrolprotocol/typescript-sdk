import { describe, expect, it } from "vitest";
import { combineSignals, safeSetInterval, safeSetTimeout } from "../../src/index.js";

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
