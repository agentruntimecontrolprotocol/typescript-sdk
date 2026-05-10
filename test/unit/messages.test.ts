import { describe, expect, it } from "vitest";
import {
  EnvelopeSchema,
  isImplementedType,
  isReservedMetricName,
  messageStatus,
  PROTOCOL_VERSION,
  RESERVED_METRIC_NAMES,
} from "../../src/index.js";

const baseFields = {
  arcp: PROTOCOL_VERSION,
  id: "msg_x",
  timestamp: "2026-05-09T13:00:00Z",
};

describe("EnvelopeSchema discriminated union", () => {
  it("parses session.open with valid auth + capabilities", () => {
    const result = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "session.open",
      payload: {
        auth: { scheme: "bearer", token: "abc" },
        client: { kind: "test", version: "0.0.1" },
        capabilities: { streaming: true },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown type as a discriminator failure", () => {
    const result = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "session.banana",
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it("session.accepted requires correlation_id", () => {
    const result = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "session.accepted",
      session_id: "sess_1",
      payload: {
        session_id: "sess_1",
        runtime: { kind: "test", version: "0.0.1" },
        capabilities: {},
      },
    });
    expect(result.success).toBe(false);
  });

  it("ack requires correlation_id", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "ack",
      correlation_id: "msg_origin",
      payload: { ack_for: "msg_origin", received_at: baseFields.timestamp },
    });
    expect(ok.success).toBe(true);
    const bad = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "ack",
      payload: { ack_for: "msg_origin", received_at: baseFields.timestamp },
    });
    expect(bad.success).toBe(false);
  });

  it("tool.invoke requires session_id", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "tool.invoke",
      session_id: "sess_1",
      payload: { tool: "fs.read", arguments: { path: "/" } },
    });
    expect(ok.success).toBe(true);
    const bad = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "tool.invoke",
      payload: { tool: "fs.read" },
    });
    expect(bad.success).toBe(false);
  });

  it("job.heartbeat requires job_id and a valid state", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "job.heartbeat",
      job_id: "job_1",
      payload: { sequence: 1, deadline_ms: 1000, state: "running" },
    });
    expect(ok.success).toBe(true);
    const badState = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "job.heartbeat",
      job_id: "job_1",
      payload: { sequence: 1, deadline_ms: 1000, state: "BANANA" },
    });
    expect(badState.success).toBe(false);
  });

  it("stream.chunk requires session_id and stream_id", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "stream.chunk",
      session_id: "sess_1",
      stream_id: "str_1",
      payload: { sequence: 0, content: "hi", role: "assistant" },
    });
    expect(ok.success).toBe(true);
    const missingStream = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "stream.chunk",
      session_id: "sess_1",
      payload: { sequence: 0 },
    });
    expect(missingStream.success).toBe(false);
  });

  it("human.input.request validates response_schema as an object", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "human.input.request",
      session_id: "sess_1",
      payload: {
        prompt: "Branch?",
        response_schema: { type: "object", properties: { branch: { type: "string" } } },
        expires_at: "2026-05-09T14:00:00Z",
      },
    });
    expect(ok.success).toBe(true);
  });

  it("human.choice.request requires at least one option", () => {
    const empty = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "human.choice.request",
      session_id: "sess_1",
      payload: { prompt: "Pick", options: [], expires_at: "2026-05-09T14:00:00Z" },
    });
    expect(empty.success).toBe(false);
  });

  it("permission.request validates structure", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "permission.request",
      session_id: "sess_1",
      payload: {
        permission: "filesystem.write",
        resource: "/tmp/x",
        operation: "write",
      },
    });
    expect(ok.success).toBe(true);
  });

  it("subscribe filter is strictly typed", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "subscribe",
      session_id: "sess_1",
      payload: {
        filter: { types: ["log"], min_priority: "normal" },
      },
    });
    expect(ok.success).toBe(true);
    const bad = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "subscribe",
      session_id: "sess_1",
      payload: { filter: { unknown_key: 1 } },
    });
    expect(bad.success).toBe(false);
  });

  it("artifact.put accepts inline base64", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "artifact.put",
      session_id: "sess_1",
      payload: {
        media_type: "application/json",
        data: "eyJob3kiOnRydWV9",
        encoding: "base64",
      },
    });
    expect(ok.success).toBe(true);
  });

  it("metric enforces reserved units on reserved names", () => {
    const wrong = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "metric",
      payload: { name: "tokens.used", value: 10, unit: "minutes" },
    });
    expect(wrong.success).toBe(false);
    const right = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "metric",
      payload: { name: "tokens.used", value: 10, unit: "tokens" },
    });
    expect(right.success).toBe(true);
  });

  it("log requires a known level", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "log",
      payload: { level: "warn", message: "x" },
    });
    expect(ok.success).toBe(true);
    const bad = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "log",
      payload: { level: "shout", message: "x" },
    });
    expect(bad.success).toBe(false);
  });

  it("trace.span requires trace_id, span_id, name", () => {
    const ok = EnvelopeSchema.safeParse({
      ...baseFields,
      type: "trace.span",
      payload: {
        trace_id: "t1",
        span_id: "s1",
        name: "compute",
        start_time: "2026-05-09T13:00:00Z",
      },
    });
    expect(ok.success).toBe(true);
  });
});

describe("messageStatus", () => {
  it("flags out-of-scope types as stubs", () => {
    expect(messageStatus("job.schedule")).toBe("stub");
    expect(messageStatus("workflow.start")).toBe("stub");
    expect(messageStatus("agent.delegate")).toBe("stub");
    expect(messageStatus("checkpoint.create")).toBe("stub");
  });
  it("flags in-scope types as implemented", () => {
    expect(isImplementedType("tool.invoke")).toBe(true);
    expect(isImplementedType("session.open")).toBe(true);
    expect(isImplementedType("human.input.request")).toBe(true);
  });
});

describe("RESERVED_METRIC_NAMES", () => {
  it("matches the list from §17.3.1", () => {
    expect([...RESERVED_METRIC_NAMES].sort()).toEqual(
      [
        "tokens.used",
        "cost.usd",
        "gpu.seconds",
        "tool.invocations",
        "latency.ms",
        "bytes.in",
        "bytes.out",
        "errors.total",
      ].sort(),
    );
  });
  it("isReservedMetricName recognizes the set", () => {
    expect(isReservedMetricName("tokens.used")).toBe(true);
    expect(isReservedMetricName("nonsense.metric")).toBe(false);
  });
});
