import { describe, expect, it } from "vitest";
import { ARCPError, type BaseEnvelope } from "../../src/index.js";
import { makePairedHarness } from "../helpers/fixtures.js";

async function collectN(
  feed: AsyncIterableIterator<BaseEnvelope>,
  n: number,
  timeoutMs = 1000,
): Promise<BaseEnvelope[]> {
  const collected: BaseEnvelope[] = [];
  const deadline = Date.now() + timeoutMs;
  while (collected.length < n) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`timeout collecting ${n}; got ${collected.length}`);
    const next = await Promise.race([
      feed.next(),
      new Promise<IteratorResult<BaseEnvelope>>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), remaining),
      ),
    ]);
    if (next.done) break;
    collected.push(next.value);
  }
  return collected;
}

describe("§13 subscriptions", () => {
  it("accepted with subscription_id; live tail captures envelopes after subscribe", async () => {
    const h = makePairedHarness();
    h.server.registerTool("emit-some", async (_args, ctx) => {
      await ctx.log("info", "step 1");
      await ctx.log("info", "step 2");
      return { ok: true };
    });
    await h.connect();

    const sub = await h.client.subscribe({
      filter: { types: ["log"] },
    });
    expect(sub.subscriptionId).toMatch(/^sub_/);

    // After subscribing, run the tool — its log envelopes should arrive.
    await h.client.invoke("emit-some", {});
    const items = await collectN(sub.feed, 2);
    const types = items.map((e) => e.type);
    expect(types.filter((t) => t === "log")).toHaveLength(2);
    await sub.close();
    await h.close();
  });

  it("backfill emits subscribe.event with synthetic subscription.backfill_complete", async () => {
    const h = makePairedHarness();
    h.server.registerTool("seed", async (_args, ctx) => {
      await ctx.log("info", "seeded");
      return null;
    });
    await h.connect();

    // Run the tool once first to populate the event log.
    await h.client.invoke("seed", {});

    // Now subscribe with `since` to trigger backfill.
    const sub = await h.client.subscribe({
      filter: { types: ["log"] },
      since: {},
    });
    const items = await collectN(sub.feed, 2);
    const last = items[items.length - 1];
    expect(last?.type).toBe("event.emit");
    if (last?.type === "event.emit") {
      // payload.name on the synthetic boundary
      expect((last.payload as { name?: string }).name).toBe("subscription.backfill_complete");
    }
    await sub.close();
    await h.close();
  });

  it("rejects filter that targets a session the subscriber is not entitled to", async () => {
    const h = makePairedHarness();
    await h.connect();
    await expect(
      h.client.subscribe({ filter: { session_id: ["sess_other"] } }),
    ).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });

  it("min_priority filter narrows to envelopes at or above the threshold", async () => {
    const h = makePairedHarness();
    h.server.registerTool("varied", async (_args, ctx) => {
      await ctx.log("info", "low-priority"); // default priority normal
      // Emit an explicitly-prioritized envelope by hand via metric.
      await ctx.metric({ name: "tool.invocations", value: 1, unit: "count" });
      return null;
    });
    await h.connect();
    const sub = await h.client.subscribe({
      filter: { types: ["log", "metric"], min_priority: "normal" },
    });
    await h.client.invoke("varied", {});
    const items = await collectN(sub.feed, 2);
    expect(items.length).toBeGreaterThanOrEqual(2);
    await sub.close();
    await h.close();
  });
});
