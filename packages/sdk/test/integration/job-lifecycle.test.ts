import { describe, expect, it } from "vitest";

import { ARCPError, type Envelope, type JobEventPayload } from "@agentruntimecontrolprotocol/sdk";

import { makePairedHarness } from "../helpers/fixtures.js";

describe("§7 job lifecycle", () => {
  it("happy path: job.submit → job.accepted → status running → job.result", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("echo", async (input) => ({ echoed: input }));
    await h.connect();

    const seenTypes: string[] = [];
    h.client.on("job.accepted", (env: Envelope) => {
      seenTypes.push(env.type);
    });
    h.client.on("job.event", (env: Envelope) => {
      seenTypes.push(env.type);
    });

    const handle = await h.client.submit({ agent: "echo", input: { x: 1 } });
    const result = await handle.done;
    expect(result.final_status).toBe("success");
    expect(result.result).toEqual({ echoed: { x: 1 } });
    expect(seenTypes).toContain("job.accepted");
    expect(handle.jobId).toMatch(/^job_/);
    await h.close();
  });

  it("emits metric events that the client can observe", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("count", async (_input, ctx) => {
      for (let i = 0; i <= 3; i++) {
        await ctx.metric({ name: "progress", value: i * 25, unit: "percent" });
      }
      return { done: true };
    });
    await h.connect();

    const events: JobEventPayload[] = [];
    h.client.on("job.event", (env) => {
      if (env.type === "job.event") events.push(env.payload);
    });

    const handle = await h.client.submit({ agent: "count" });
    const result = await handle.done;
    expect(result.final_status).toBe("success");
    const metrics = events.filter((e) => e.kind === "metric");
    expect(metrics.length).toBe(4);
    await h.close();
  });

  it("agent throw resolves submit as a job.error rejection", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("boom", async () => {
      throw new Error("boom");
    });
    await h.connect();

    const handle = await h.client.submit({ agent: "boom" });
    await expect(handle.done).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });

  it("AGENT_NOT_AVAILABLE for unknown agent rejects the submit", async () => {
    const h = makePairedHarness();
    await h.connect();
    await expect(h.client.submit({ agent: "unknown" })).rejects.toMatchObject({
      code: "AGENT_NOT_AVAILABLE",
    });
    await h.close();
  });

  it("§7.4 job.cancel acks with job.cancelled before job.error{CANCELLED}", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("slow", async (_input, ctx) => {
      await new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener(
          "abort",
          () => {
            reject(
              ctx.signal.reason instanceof Error
                ? ctx.signal.reason
                : new Error("aborted"),
            );
          },
          { once: true },
        );
      });
      return null;
    });
    await h.connect();

    const timeline: string[] = [];
    h.client.on("job.cancelled", (env) => {
      timeline.push(env.type);
    });
    h.client.on("job.error", (env) => {
      timeline.push(env.type);
    });

    const handle = await h.client.submit({ agent: "slow" });
    await h.client.cancelJob(handle.jobId, { reason: "user requested" });
    await expect(handle.done).rejects.toMatchObject({ code: "CANCELLED" });

    // The §7.4 acknowledgement MUST arrive ahead of the terminal job.error.
    expect(timeline[0]).toBe("job.cancelled");
    expect(timeline).toContain("job.error");
    await h.close();
  });

  it("event_seq is monotonic across emit kinds", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("emit", async (_i, ctx) => {
      await ctx.log("info", "first");
      await ctx.thought("thinking");
      await ctx.metric({ name: "x", value: 1, unit: "count" });
      return null;
    });
    await h.connect();

    const seqs: number[] = [];
    h.client.on("job.event", (env) => {
      if (env.type === "job.event" && env.event_seq !== undefined)
        seqs.push(env.event_seq);
    });
    h.client.on("job.result", (env) => {
      if (env.type === "job.result" && env.event_seq !== undefined)
        seqs.push(env.event_seq);
    });

    const handle = await h.client.submit({ agent: "emit" });
    await handle.done;
    // Wait a tick for event_seq tracking to settle.
    await new Promise<void>((r) => setTimeout(r, 5));
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] ?? 0);
    }
    await h.close();
  });
});
