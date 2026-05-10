import { describe, expect, it } from "vitest";
import { ARCPError, type Envelope } from "../../src/index.js";
import { awaitNonNull, makePairedHarness, waitFor } from "../helpers/fixtures.js";

describe("§10.4 cancellation", () => {
  it("cooperative cancel: handler honors signal, invocation rejects with CancelledError", async () => {
    const h = makePairedHarness();
    let observedJobId: string | null = null;
    h.client.on("job.accepted", (env: Envelope) => {
      if (env.type === "job.accepted") observedJobId = env.payload.job_id;
    });
    h.server.registerTool("waiter", async (_args, ctx) => {
      await new Promise<void>((_, reject) => {
        ctx.signal.addEventListener(
          "abort",
          () => {
            reject(ctx.signal.reason);
          },
          { once: true },
        );
      });
      return { unreached: true };
    });
    await h.connect();
    const invocation = h.client.invoke("waiter", {});
    // Wait until we know the job_id so we can cancel.
    await waitFor(() => observedJobId !== null);
    if (observedJobId === null) throw new Error("no job_id observed");
    await h.client.cancelJob(observedJobId, { reason: "user_aborted" });
    await expect(invocation).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });

  it("cancel of unknown job ⇒ cancel.refused", async () => {
    const h = makePairedHarness();
    await h.connect();
    let refusal: { reason: string } | null = null;
    h.client.on("cancel.refused", (env: Envelope) => {
      if (env.type === "cancel.refused") refusal = { reason: env.payload.reason };
    });
    await h.client.cancelJob("job_nope");
    const r = await awaitNonNull(() => refusal);
    expect(r.reason).toBe("not_found");
    await h.close();
  });

  it("hard kill after deadline: handler ignores signal, runtime emits ABORTED", async () => {
    const h = makePairedHarness();
    let observedJobId: string | null = null;
    h.client.on("job.accepted", (env: Envelope) => {
      if (env.type === "job.accepted") observedJobId = env.payload.job_id;
    });
    h.server.registerTool("ignore", async () => {
      // Simulate a hostile handler that ignores cancellation.
      await new Promise<void>((r) => setTimeout(r, 200));
      return { unreached: true };
    });
    await h.connect();
    const invocation = h.client.invoke("ignore", {});
    await waitFor(() => observedJobId !== null);
    if (observedJobId === null) throw new Error("no job_id observed");
    await h.client.cancelJob(observedJobId, { reason: "stop", deadlineMs: 30 });
    await expect(invocation).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });
});
