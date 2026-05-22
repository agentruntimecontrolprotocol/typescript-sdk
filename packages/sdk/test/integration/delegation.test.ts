import { describe, expect, it } from "vitest";

import type { Envelope, JobEventPayload } from "@agentruntimecontrolprotocol/sdk";

import { makePairedHarness } from "../helpers/fixtures.js";

describe("§10 delegation", () => {
  it("creates a child job when lease_request is a subset of parent lease", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("parent", async (_input, ctx) => {
      await ctx.delegate({
        delegate_id: "del_1",
        agent: "child",
        input: { hello: 1 },
        lease_request: { "fs.read": ["/workspace/**"] },
      });
      // Block until the child completes by sleeping briefly.
      await new Promise<void>((r) => setTimeout(r, 50));
      return { ok: true };
    });
    h.server.registerAgent("child", async () => ({ child_done: true }));
    await h.connect();

    const accepted: Envelope[] = [];
    h.client.on("job.accepted", (env) => {
      accepted.push(env);
    });

    const handle = await h.client.submit({
      agent: "parent",
      lease: { "fs.read": ["/workspace/**"] },
    });
    await handle.done;
    await new Promise<void>((r) => setTimeout(r, 30));

    // Two job.accepted envelopes: one for parent, one for child.
    expect(accepted.length).toBeGreaterThanOrEqual(2);
    const child = accepted.find(
      (env) =>
        env.type === "job.accepted" &&
        (env.payload as { parent_job_id?: string }).parent_job_id !== undefined,
    );
    expect(child).toBeDefined();
    if (child?.type === "job.accepted") {
      expect(child.payload.delegate_id).toBe("del_1");
    }

    await h.close();
  });

  it("returns LEASE_SUBSET_VIOLATION as tool_result on parent when child lease exceeds parent", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("parent", async (_input, ctx) => {
      await ctx.delegate({
        delegate_id: "del_2",
        agent: "child",
        input: {},
        // Child requests broader than parent
        lease_request: { "fs.read": ["/etc/**"] },
      });
      await new Promise<void>((r) => setTimeout(r, 30));
      return { ok: true };
    });
    h.server.registerAgent("child", async () => null);
    await h.connect();

    const events: JobEventPayload[] = [];
    h.client.on("job.event", (env) => {
      if (env.type === "job.event") events.push(env.payload);
    });

    const handle = await h.client.submit({
      agent: "parent",
      lease: { "fs.read": ["/workspace/**"] },
    });
    await handle.done;
    await new Promise<void>((r) => setTimeout(r, 30));

    const violationToolResult = events.find(
      (e) =>
        e.kind === "tool_result" &&
        typeof e.body === "object" &&
        e.body !== null &&
        (e.body as { error?: { code?: string } }).error?.code ===
          "LEASE_SUBSET_VIOLATION",
    );
    expect(violationToolResult).toBeDefined();
    await h.close();
  });
});
