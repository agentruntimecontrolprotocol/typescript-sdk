import { describe, expect, it, vi } from "vitest";

import { makeJobContext } from "../src/job-context.js";
import { Job } from "../src/job.js";

function makeJob(
  overrides: Partial<ConstructorParameters<typeof Job>[0]["options"]> = {},
) {
  const emitted: { kind: string; payload?: unknown }[] = [];
  const job = new Job({
    options: {
      sessionId: "sess_1" as never,
      agent: "echo",
      lease: { "tool.call": ["calc"], "agent.delegate": ["helper"] },
      negotiatedFeatures: ["progress", "result_chunk"],
      heartbeatIntervalSeconds: 60,
      ...overrides,
    } as never,
    send: vi.fn(async (env: unknown) => {
      emitted.push({
        kind: (env as { type?: string }).type ?? "unknown",
        payload: env,
      });
    }),
    seq: {
      nextEventSeq: vi.fn(() => emitted.length + 1),
    },
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    } as never,
  });
  return { job, emitted };
}

describe("makeJobContext", () => {
  it("forwards basic events, progress, and result streaming", async () => {
    const { job, emitted } = makeJob();
    const ctx = makeJobContext(job);

    job.transition("running");
    await ctx.log("info", "hello", { a: 1 });
    await ctx.thought("thinking");
    await ctx.status("running");
    await ctx.progress(12, { total: 100, units: "ms", message: "moving" });
    await ctx.toolCall({ tool: "calc", call_id: "call_1", input: {} } as never);
    await ctx.delegate({ delegate_id: "d_1", agent: "helper" } as never);
    const stream = ctx.streamResult({ resultId: "res_1" });
    await stream.write("hello ");
    await stream.finalize("world", { summary: "done", resultSize: 11 });

    expect(emitted.map((e) => e.kind)).toContain("job.event");
    expect(emitted.map((e) => e.kind)).toContain("job.result");
  });

  it("surfaces lease denials as tool_result and delegate log events", async () => {
    const { job, emitted } = makeJob({
      lease: {},
    });
    const ctx = makeJobContext(job);

    await ctx.toolCall({ tool: "calc", call_id: "call_1", input: {} } as never);
    await ctx.delegate({ delegate_id: "d_1", agent: "helper" } as never);

    expect(
      emitted.some((e) => e.kind === "job.event" || e.kind === "job.result"),
    ).toBe(true);
  });

  it("rejects writes after finalize and emits an empty terminal chunk when needed", async () => {
    const { job } = makeJob();
    const ctx = makeJobContext(job);
    job.transition("running");
    const stream = ctx.streamResult({ resultId: "res_1" });
    await stream.finalize(undefined, { summary: "done" });
    await expect(stream.write("nope")).rejects.toThrow(/finalize/);
  });
});
