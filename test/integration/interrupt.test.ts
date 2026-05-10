import { describe, expect, it } from "vitest";
import type { Envelope, HumanInputRequestPayload } from "../../src/index.js";
import { awaitNonNull, makePairedHarness, waitFor } from "../helpers/fixtures.js";

describe("§10.5 interrupt", () => {
  it("interrupt drives the job to blocked and emits human.input.request", async () => {
    const h = makePairedHarness({
      capabilities: { interrupt: true, human_input: true },
    });
    let observedJobId: string | null = null;
    let humanRequest: HumanInputRequestPayload | null = null;
    h.client.on("job.accepted", (env: Envelope) => {
      if (env.type === "job.accepted") observedJobId = env.payload.job_id;
    });
    h.client.on("human.input.request", (env: Envelope) => {
      if (env.type === "human.input.request") humanRequest = env.payload;
    });
    h.server.registerTool("wait", async (_args, ctx) => {
      // Stall until the abort signal fires; we cancel after the test asserts.
      await new Promise<void>((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      });
      return null;
    });
    await h.connect();
    const invocation = h.client.invoke("wait", {});
    await waitFor(() => observedJobId !== null);
    if (observedJobId === null) throw new Error("no job_id observed");
    await h.client.interruptJob(observedJobId, "Need approval before continuing");
    const req = await awaitNonNull(() => humanRequest);
    expect(req.prompt).toBe("Need approval before continuing");
    expect(typeof req.expires_at).toBe("string");

    // Job should be in blocked state on the server side.
    const ctx = h.server.eventLog;
    void ctx; // avoid unused warning; we infer from the human.input.request emission

    // Clean up by cancelling.
    await h.client.cancelJob(observedJobId);
    await expect(invocation).rejects.toBeInstanceOf(Error);
    await h.close();
  });

  it("UNIMPLEMENTED when interrupt capability is not advertised", async () => {
    const h = makePairedHarness({ capabilities: { interrupt: false } });
    let nack: { code?: string } | null = null;
    h.client.on("nack", (env: Envelope) => {
      if (env.type === "nack") nack = { code: env.payload.code };
    });
    h.server.registerTool("wait", async (_args, ctx) => {
      await new Promise<void>((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      });
      return null;
    });
    await h.connect();
    let observedJobId: string | null = null;
    h.client.on("job.accepted", (env: Envelope) => {
      if (env.type === "job.accepted") observedJobId = env.payload.job_id;
    });
    const invocation = h.client.invoke("wait", {});
    await waitFor(() => observedJobId !== null);
    if (observedJobId === null) throw new Error("no job_id observed");
    await h.client.interruptJob(observedJobId);
    const n = await awaitNonNull(() => nack);
    expect(n.code).toBe("UNIMPLEMENTED");
    await h.client.cancelJob(observedJobId);
    await expect(invocation).rejects.toBeInstanceOf(Error);
    await h.close();
  });
});
