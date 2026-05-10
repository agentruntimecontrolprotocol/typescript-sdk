import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCPError, type Envelope, InternalError } from "../../src/index.js";
import { makePairedHarness } from "../helpers/fixtures.js";

describe("§10 job lifecycle", () => {
  it("happy path: tool.invoke → job.accepted → job.started → tool.result", async () => {
    const h = makePairedHarness();
    h.server.registerTool("echo", async (args) => ({ echoed: args }));
    await h.connect();

    const seenTypes: string[] = [];
    h.client.on("job.accepted", (env: Envelope) => {
      seenTypes.push(env.type);
    });
    h.client.on("job.started", (env: Envelope) => {
      seenTypes.push(env.type);
    });

    const out = await h.client.invoke("echo", { x: 1 });
    expect(out.result.value).toEqual({ echoed: { x: 1 } });
    expect(seenTypes).toContain("job.accepted");
    expect(seenTypes).toContain("job.started");
    expect(out.jobId).toMatch(/^job_/);
    await h.close();
  });

  it("emits progress events that are observable on the client", async () => {
    const h = makePairedHarness();
    h.server.registerTool("count", async (_args, ctx) => {
      for (let i = 0; i <= 3; i++) {
        await ctx.emitProgress({ percent: i * 25, message: `step ${i}` });
      }
      return { done: true };
    });
    await h.connect();

    const out = await h.client.invoke("count", {});
    expect(out.result.value).toEqual({ done: true });
    expect(out.progress.length).toBe(4);
    expect(out.progress[0]?.percent).toBe(0);
    expect(out.progress[3]?.percent).toBe(75);
    await h.close();
  });

  it("tool.error on handler throw resolves invocation as a rejection", async () => {
    const h = makePairedHarness();
    h.server.registerTool("boom", async () => {
      throw new InternalError("boom");
    });
    await h.connect();

    await expect(h.client.invoke("boom", {})).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });

  it("UNIMPLEMENTED when tool is not registered", async () => {
    const h = makePairedHarness();
    await h.connect();
    await expect(h.client.invoke("unknown", {})).rejects.toBeInstanceOf(Error);
    await h.close();
  });

  describe("heartbeat watchdog (fake timers)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("transitions to failed with HEARTBEAT_LOST after 2 missed deadlines", async () => {
      const h = makePairedHarness(
        { capabilities: { heartbeat_interval_seconds: 1 } },
        { capabilities: { heartbeat_interval_seconds: 1 } },
      );
      h.server.registerTool("stall", async (_args, ctx) => {
        // Wait for the abort signal — never emits any heartbeat or progress.
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("aborted");
      });
      await h.connect();

      const invocation = h.client.invoke("stall", {});
      // Attach a catch eagerly so the rejection is never "unhandled".
      const settled = invocation.then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e }),
      );

      // Drain any timers scheduled in real time, then advance fake time past
      // 2 × heartbeat interval (2 × 1000ms) to trigger HEARTBEAT_LOST.
      await vi.runOnlyPendingTimersAsync();
      await vi.advanceTimersByTimeAsync(2500);
      await vi.runOnlyPendingTimersAsync();

      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.e).toBeInstanceOf(ARCPError);
        if (result.e instanceof ARCPError) {
          expect(result.e.code).toBe("HEARTBEAT_LOST");
        }
      }
      vi.useRealTimers();
      await h.close();
    });
  });
});
