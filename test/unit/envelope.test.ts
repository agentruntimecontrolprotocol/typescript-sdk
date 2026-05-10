import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BaseEnvelopeSchema,
  buildEnvelope,
  EnvelopeExtensionsSchema,
  messageEnvelope,
  PROTOCOL_VERSION,
  PrioritySchema,
  pickDefined,
  RoundTripEnvelopeSchema,
} from "../../src/index.js";

const minimalEnvelope = {
  arcp: PROTOCOL_VERSION,
  id: "msg_01",
  type: "ping",
  timestamp: "2026-05-09T13:00:00Z",
  payload: {},
};

describe("BaseEnvelopeSchema", () => {
  it("accepts a minimal valid envelope", () => {
    const result = BaseEnvelopeSchema.parse(minimalEnvelope);
    expect(result.arcp).toBe(PROTOCOL_VERSION);
    expect(result.id).toBe("msg_01");
    expect(result.type).toBe("ping");
  });

  it("rejects an envelope missing arcp", () => {
    const { arcp: _omit, ...rest } = minimalEnvelope;
    const result = BaseEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an envelope missing id", () => {
    const { id: _omit, ...rest } = minimalEnvelope;
    const result = BaseEnvelopeSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an envelope with empty id", () => {
    const result = BaseEnvelopeSchema.safeParse({ ...minimalEnvelope, id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an envelope with invalid timestamp", () => {
    const result = BaseEnvelopeSchema.safeParse({
      ...minimalEnvelope,
      timestamp: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("accepts every optional field", () => {
    const env = {
      ...minimalEnvelope,
      source: "client",
      target: "runtime",
      session_id: "sess_1",
      job_id: "job_1",
      stream_id: "str_1",
      subscription_id: "sub_1",
      trace_id: "trace_1",
      span_id: "span_1",
      parent_span_id: "span_0",
      correlation_id: "msg_00",
      causation_id: "msg_00",
      idempotency_key: "intent_1",
      priority: "high" as const,
    };
    const result = BaseEnvelopeSchema.parse(env);
    expect(result.priority).toBe("high");
    expect(result.session_id).toBe("sess_1");
    expect(result.idempotency_key).toBe("intent_1");
  });

  it("rejects unknown priority values", () => {
    const result = BaseEnvelopeSchema.safeParse({ ...minimalEnvelope, priority: "urgent" });
    expect(result.success).toBe(false);
  });

  it("validates priority enum exhaustively", () => {
    for (const p of ["low", "normal", "high", "critical"] as const) {
      expect(PrioritySchema.parse(p)).toBe(p);
    }
  });

  it("round-trips JSON without losing fields when using passthrough", () => {
    const wire = JSON.stringify({
      ...minimalEnvelope,
      session_id: "sess_x",
      extensions: { "arcpx.example.test.v1": { extra: 1 } },
    });
    const parsed = RoundTripEnvelopeSchema.parse(JSON.parse(wire));
    expect(parsed.extensions).toBeDefined();
    expect(parsed.session_id).toBe("sess_x");
  });
});

describe("EnvelopeExtensionsSchema", () => {
  it("accepts the bare 'optional' key", () => {
    expect(EnvelopeExtensionsSchema.parse({ optional: true })).toEqual({ optional: true });
  });

  it("accepts properly namespaced keys", () => {
    expect(
      EnvelopeExtensionsSchema.parse({
        "arcpx.acme.thing.v1": { ok: true },
        "com.example.flow.v2": { stage: "x" },
      }),
    ).toBeDefined();
  });

  it("rejects bare keys outside the reserved set", () => {
    const result = EnvelopeExtensionsSchema.safeParse({ random: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects x- prefixed keys", () => {
    const result = EnvelopeExtensionsSchema.safeParse({ "x-experimental": true });
    expect(result.success).toBe(false);
  });
});

describe("buildEnvelope", () => {
  it("strips undefined optional fields", () => {
    const env = buildEnvelope({
      id: "msg_x",
      type: "ping",
      timestamp: "2026-05-09T13:00:00Z",
      payload: {},
      optional: { session_id: undefined, job_id: "job_1", priority: undefined },
    });
    expect(env).not.toHaveProperty("session_id");
    expect(env.job_id).toBe("job_1");
    expect(env).not.toHaveProperty("priority");
    expect(env.arcp).toBe(PROTOCOL_VERSION);
  });

  it("produces an object that parses against the base schema", () => {
    const env = buildEnvelope({
      id: "msg_x",
      type: "ping",
      timestamp: "2026-05-09T13:00:00Z",
      payload: {},
      optional: { session_id: "sess_1" },
    });
    const parsed = BaseEnvelopeSchema.parse(env);
    expect(parsed.session_id).toBe("sess_1");
  });
});

describe("pickDefined", () => {
  it("removes undefined keys", () => {
    expect(pickDefined({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("preserves null values (only undefined is stripped)", () => {
    expect(pickDefined({ a: null })).toEqual({ a: null });
  });
});

describe("messageEnvelope helper", () => {
  it("produces a schema constrained to the literal type", () => {
    const PingPayload = z.object({});
    const PingEnv = messageEnvelope("ping", PingPayload);
    const ok = PingEnv.parse({ ...minimalEnvelope, type: "ping", payload: {} });
    expect(ok.type).toBe("ping");
    const bad = PingEnv.safeParse({ ...minimalEnvelope, type: "pong", payload: {} });
    expect(bad.success).toBe(false);
  });

  it("validates the typed payload", () => {
    const Payload = z.object({ count: z.number() });
    const Env = messageEnvelope("metric", Payload);
    const ok = Env.parse({
      ...minimalEnvelope,
      type: "metric",
      payload: { count: 5 },
    });
    expect(ok.payload.count).toBe(5);
    const bad = Env.safeParse({
      ...minimalEnvelope,
      type: "metric",
      payload: { count: "not-a-number" },
    });
    expect(bad.success).toBe(false);
  });
});
