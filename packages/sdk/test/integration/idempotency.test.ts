import { describe, expect, it } from "vitest";

import { makePairedHarness } from "../helpers/fixtures.js";

describe("§7.2 idempotency", () => {
  it("re-submitting with same idempotency_key returns the same job_id", async () => {
    const h = makePairedHarness();
    let runs = 0;
    h.server.registerAgent("echo", async (input) => {
      runs += 1;
      return { echoed: input };
    });
    await h.connect();

    const h1 = await h.client.submit({
      agent: "echo",
      input: { x: 1 },
      idempotencyKey: "key-1",
    });
    await h1.done;
    const h2 = await h.client.submit({
      agent: "echo",
      input: { x: 1 },
      idempotencyKey: "key-1",
    });
    expect(h2.jobId).toBe(h1.jobId);
    void h2.done.catch(() => undefined);
    expect(runs).toBe(1);
    await h.close();
  });

  it("re-submitting with same key but different agent yields DUPLICATE_KEY", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("echo", async (input) => ({ echoed: input }));
    h.server.registerAgent("other", async (input) => ({ other: input }));
    await h.connect();

    const h1 = await h.client.submit({
      agent: "echo",
      input: { x: 1 },
      idempotencyKey: "key-2",
    });
    await h1.done;
    await expect(
      h.client.submit({
        agent: "other",
        input: { x: 1 },
        idempotencyKey: "key-2",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_KEY" });
    await h.close();
  });

  it("treats changed lease params as a DUPLICATE_KEY conflict", async () => {
    const h = makePairedHarness();
    h.server.registerAgent("echo", async (input) => ({ echoed: input }));
    await h.connect();

    const h1 = await h.client.submit({
      agent: "echo",
      input: { x: 1 },
      idempotencyKey: "key-lease",
      lease: { "cost.budget": ["USD:1.00"] },
    });
    await h1.done;
    await expect(
      h.client.submit({
        agent: "echo",
        input: { x: 1 },
        idempotencyKey: "key-lease",
        lease: { "cost.budget": ["USD:2.00"] },
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_KEY" });
    await h.close();
  });
});
