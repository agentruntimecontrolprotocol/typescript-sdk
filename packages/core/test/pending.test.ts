import { describe, expect, it } from "vitest";

import { CancelledError, PendingRegistry, TimeoutError } from "@arcp/core";

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
