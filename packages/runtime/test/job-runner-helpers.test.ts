import { buildEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import {
  AgentVersionNotAvailableError,
  CancelledError,
  LeaseSubsetViolationError,
} from "@agentruntimecontrolprotocol/core/errors";
import type {
  DelegateBody,
  JobErrorPayload,
  JobResultPayload,
} from "@agentruntimecontrolprotocol/core/messages";
import { SessionState } from "@agentruntimecontrolprotocol/core/state";
import { describe, expect, it, vi } from "vitest";

import type { Job } from "../src/job.js";
import {
  emitAgentResolveError,
  emitArcpError,
  emitHandlerFailure,
  emitParseError,
  forwardEventToSubscriber,
  runAndEmitResult,
  scheduleRuntimeTimeout,
  validateDelegateLease,
  wrapJobCtx,
} from "../src/job-runner-helpers.js";

function makeJob(overrides: Partial<Job> = {}) {
  const emitted: { kind: string; payload?: unknown }[] = [];
  const job = {
    jobId: "job_1",
    lease: { "tool.call": ["calc"], "agent.delegate": ["helper"] },
    budget: new Map([["USD", 10]]),
    leaseConstraints: undefined,
    isTerminal: false,
    chunkedResultStarted: false,
    activeResultId: undefined,
    activeResultNextChunkSeq: 0,
    resultChunkFinalized: false,
    abortController: new AbortController(),
    emitEventKind: vi.fn(async (kind: string, payload: unknown) => {
      emitted.push({ kind, payload });
    }),
    emitResult: vi.fn(async (payload: JobResultPayload) => {
      emitted.push({ kind: "result", payload });
    }),
    emitErrorEnvelope: vi.fn(async (payload: JobErrorPayload) => {
      emitted.push({ kind: "error", payload });
    }),
    ...overrides,
  } as unknown as Job;
  return { job, emitted };
}

describe("job-runner-helpers", () => {
  it("wrapJobCtx forwards delegate and metric hooks", async () => {
    const base: any = {
      metric: vi.fn(async () => undefined),
    };
    const delegate = vi.fn(async () => undefined);
    const metric = vi.fn(async () => undefined);
    const ctx = wrapJobCtx({
      base,
      delegateInterceptor: delegate,
      metricInterceptor: metric,
    });
    await ctx.metric({ name: "cost.usd", value: 1 } as never);
    await ctx.delegate({ delegate_id: "d_1", agent: "helper" } as never);
    expect(delegate).toHaveBeenCalled();
    expect(metric).toHaveBeenCalled();
  });

  it("emits parse and auth errors through the session/job channels", async () => {
    const ctx: any = {
      emitJobError: vi.fn(async () => undefined),
      emitSessionError: vi.fn(async () => undefined),
    };
    await emitParseError(ctx, new Error("bad parse"));
    await emitAgentResolveError(ctx, new Error("missing"), "agent-a@v1");
    await emitAgentResolveError(
      ctx,
      new AgentVersionNotAvailableError("expired"),
      "agent-a@v1",
    );
    await emitArcpError(ctx, new Error("bad request"));
    expect(ctx.emitJobError).toHaveBeenCalled();
    expect(ctx.emitSessionError).toHaveBeenCalled();
  });

  it("runs handlers and emits success or chunked results", async () => {
    const { job, emitted } = makeJob();
    const wrappedCtx: any = { marker: "ctx" };
    await runAndEmitResult({
      job,
      handler: async () => ({ ok: true }),
      input: {},
      wrappedCtx,
    });
    expect(emitted.some((e) => e.kind === "result")).toBe(true);

    job.chunkedResultStarted = true;
    job.activeResultId = "res_1";
    job.activeResultNextChunkSeq = 2;
    emitted.length = 0;
    await runAndEmitResult({
      job,
      handler: async () => ({ ok: true }),
      input: {},
      wrappedCtx,
    });
    expect(emitted.some((e) => e.kind === "result")).toBe(true);
    expect(emitted.some((e) => e.kind === "result_chunk")).toBe(true);
  });

  it("wraps handler failures into terminal error envelopes", async () => {
    const { job } = makeJob();
    await emitHandlerFailure(job, new Error("oops"));
    await emitHandlerFailure(job, new CancelledError("bye"));
    expect(vi.mocked(job.emitErrorEnvelope).mock.calls.length).toBeGreaterThan(
      0,
    );
  });

  it("validates delegate leases and forwards subscriber events", async () => {
    const parent = {
      lease: { "agent.delegate": ["helper"], "tool.call": ["calc"] },
      budget: new Map([["USD", 10]]),
      leaseConstraints: undefined,
    } as unknown as Job;
    expect(
      validateDelegateLease({ "tool.call": ["calc"] }, parent, {
        delegate_id: "d_1",
        agent: "helper",
      } as DelegateBody),
    ).toBeNull();
    expect(
      validateDelegateLease({ "tool.call": ["nope"] }, parent, {
        delegate_id: "d_1",
        agent: "helper",
      } as DelegateBody),
    ).toBeInstanceOf(LeaseSubsetViolationError);

    const sub: any = {
      state: new SessionState(),
      send: vi.fn(async () => undefined),
      nextEventSeq: vi.fn(() => 42),
    };
    sub.state.assignId("sess_1" as never);
    const src = buildEnvelope({
      id: "msg_1",
      type: "job.event",
      payload: { kind: "log", ts: new Date().toISOString(), body: { x: 1 } },
      optional: {
        session_id: "sess_1" as never,
        job_id: "job_1" as never,
        trace_id: "0123456789abcdef0123456789abcdef" as never,
        event_seq: 1 as never,
      },
    });
    await forwardEventToSubscriber(sub, src);
    expect(sub.send).toHaveBeenCalled();

    const directSub: any = {
      state: new SessionState(),
      send: vi.fn(async () => undefined),
      transport: { send: vi.fn(async () => undefined) },
      server: { eventLog: { append: vi.fn(async () => undefined) } },
      nextEventSeq: vi.fn(() => 43),
    };
    directSub.state.assignId("sess_2" as never);
    await forwardEventToSubscriber(directSub, src, { fanOut: false });
    expect(directSub.send).not.toHaveBeenCalled();
    expect(directSub.server.eventLog.append).toHaveBeenCalled();
    expect(directSub.transport.send).toHaveBeenCalled();
  });

  it("schedules runtime timeout and aborts non-terminal jobs", async () => {
    vi.useFakeTimers();
    try {
      const { job } = makeJob();
      const timer = scheduleRuntimeTimeout(job, 1);
      expect(timer).not.toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      expect((job.abortController.signal.reason as Error).message).toMatch(
        /max_runtime_sec/i,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
