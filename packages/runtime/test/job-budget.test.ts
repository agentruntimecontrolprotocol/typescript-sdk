import { silentLogger } from "@agentruntimecontrolprotocol/core/logger";
import { describe, expect, it } from "vitest";

import { Job } from "../src/job.js";

function makeJob(initialBudget: ReadonlyMap<string, number>): Job {
  return new Job({
    options: {
      sessionId: "sess_test",
      agent: "test",
      lease: {},
      initialBudget,
      heartbeatIntervalSeconds: 30,
    },
    send: async () => undefined,
    seq: { nextEventSeq: () => 1 },
    logger: silentLogger,
  });
}

describe("Job.shouldEmitBudgetRemaining (issue #80)", () => {
  it("emits exactly once when the initial budget is zero", () => {
    const job = makeJob(new Map([["tokens", 0]]));
    // First tick — always emits to seed `lastEmittedRemaining`.
    expect(job.shouldEmitBudgetRemaining("tokens")).toBe(true);
    // Subsequent ticks at the same remaining must NOT emit (the previous
    // implementation flooded the event stream when initial=0).
    for (let i = 0; i < 10; i += 1) {
      expect(job.shouldEmitBudgetRemaining("tokens")).toBe(false);
    }
  });

  it("emits on the seed call for a non-zero budget", () => {
    const job = makeJob(new Map([["USD", 100]]));
    expect(job.shouldEmitBudgetRemaining("USD")).toBe(true);
  });

  it("returns false for an unknown currency", () => {
    const job = makeJob(new Map());
    expect(job.shouldEmitBudgetRemaining("ETH")).toBe(false);
  });
});
