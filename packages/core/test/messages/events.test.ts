import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DelegateBodySchema,
  isReservedEventKind,
  isVendorEventKind,
  JobEventPayloadSchema,
  parseJobEventBody,
  ProgressBodySchema,
  RESERVED_EVENT_KINDS,
  ResultChunkBodySchema,
  StatusBodySchema,
  ThoughtBodySchema,
  ToolCallBodySchema,
  ToolResultBodySchema,
} from "@agentruntimecontrolprotocol/core";

import { decode } from "../decode-schema.js";

// Per §8 / §8.2 / §8.2.1 / §8.4, the `job.event.payload.body` is a
// discriminated wire shape keyed by `kind`. These tests pin the JSON
// shapes accepted/rejected by the migrated Effect schemas in events.ts
// and exercise the discriminated dispatch through `parseJobEventBody`.

describe("ProgressBodySchema (Effect Schema)", () => {
  it("accepts the docs/guides/job-events.md progress example", async () => {
    const input = {
      current: 5,
      total: 12,
      units: "urls",
      message: "processed https://example.com",
    };
    await expect(decode(ProgressBodySchema)(input)).resolves.toEqual(input);
  });

  it("accepts the minimum shape (current only)", async () => {
    await expect(decode(ProgressBodySchema)({ current: 0 })).resolves.toEqual({
      current: 0,
    });
  });

  it("rejects negative current (zod parity: nonnegative)", async () => {
    await expect(decode(ProgressBodySchema)({ current: -1 })).rejects.toThrow();
  });

  it("rejects empty units (zod parity: .min(1) when present)", async () => {
    await expect(
      decode(ProgressBodySchema)({ current: 1, units: "" }),
    ).rejects.toThrow();
  });
});

describe("ResultChunkBodySchema (Effect Schema)", () => {
  it("accepts a utf8 chunk", async () => {
    const input = {
      result_id: "r-1",
      chunk_seq: 0,
      data: "hello",
      encoding: "utf8" as const,
      more: true,
    };
    await expect(decode(ResultChunkBodySchema)(input)).resolves.toEqual(input);
  });

  it("accepts the final base64 chunk", async () => {
    const input = {
      result_id: "r-1",
      chunk_seq: 9,
      data: "Zm9v",
      encoding: "base64" as const,
      more: false,
    };
    await expect(decode(ResultChunkBodySchema)(input)).resolves.toEqual(input);
  });

  it("rejects unknown encodings", async () => {
    await expect(
      decode(ResultChunkBodySchema)({
        result_id: "r-1",
        chunk_seq: 0,
        data: "x",
        encoding: "hex",
        more: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects non-integer chunk_seq", async () => {
    await expect(
      decode(ResultChunkBodySchema)({
        result_id: "r-1",
        chunk_seq: 1.5,
        data: "x",
        encoding: "utf8",
        more: true,
      }),
    ).rejects.toThrow();
  });
});

describe("ThoughtBodySchema (Effect Schema)", () => {
  it("accepts text", async () => {
    await expect(
      decode(ThoughtBodySchema)({ text: "thinking..." }),
    ).resolves.toEqual({ text: "thinking..." });
  });

  it("rejects missing text", async () => {
    await expect(decode(ThoughtBodySchema)({})).rejects.toThrow();
  });
});

describe("ToolCallBodySchema (Effect Schema)", () => {
  it("accepts the docs/guides/job-events.md tool_call example", async () => {
    const input = {
      tool: "web.search",
      args: { q: "ARCP spec" },
      call_id: "s1",
    };
    await expect(decode(ToolCallBodySchema)(input)).resolves.toEqual(input);
  });

  it("rejects empty tool / call_id", async () => {
    await expect(
      decode(ToolCallBodySchema)({ tool: "", call_id: "x" }),
    ).rejects.toThrow();
    await expect(
      decode(ToolCallBodySchema)({ tool: "t", call_id: "" }),
    ).rejects.toThrow();
  });
});

describe("ToolResultBodySchema (Effect Schema)", () => {
  it("accepts a result-only body", async () => {
    const input = { call_id: "s1", result: { hits: [] } };
    await expect(decode(ToolResultBodySchema)(input)).resolves.toEqual(input);
  });

  it("accepts an error-only body", async () => {
    const input = {
      call_id: "s1",
      error: { code: "PERMISSION_DENIED" as const, message: "no" },
    };
    await expect(decode(ToolResultBodySchema)(input)).resolves.toEqual(input);
  });

  it("accepts an empty body (void tool)", async () => {
    await expect(
      decode(ToolResultBodySchema)({ call_id: "s1" }),
    ).resolves.toEqual({ call_id: "s1" });
  });

  it("rejects both result and error (mutual exclusion via Schema.filter)", async () => {
    await expect(
      decode(ToolResultBodySchema)({
        call_id: "s1",
        result: 1,
        error: { code: "INTERNAL_ERROR", message: "x" },
      }),
    ).rejects.toThrow();
  });
});

describe("StatusBodySchema (Effect Schema)", () => {
  it("accepts a phase-only body", async () => {
    await expect(
      decode(StatusBodySchema)({ phase: "running" }),
    ).resolves.toEqual({ phase: "running" });
  });

  it("rejects empty phase", async () => {
    await expect(decode(StatusBodySchema)({ phase: "" })).rejects.toThrow();
  });
});

describe("DelegateBodySchema (Effect Schema)", () => {
  it("accepts the docs/guides/job-events.md delegate example", async () => {
    const input = {
      delegate_id: "d-1",
      agent: "child",
      input: { x: 1 },
      lease_request: { "tool.call": ["web.fetch"] },
    };
    await expect(decode(DelegateBodySchema)(input)).resolves.toEqual(input);
  });

  it("accepts a minimal delegate body", async () => {
    const input = { delegate_id: "d-1", agent: "child", input: null };
    await expect(decode(DelegateBodySchema)(input)).resolves.toEqual(input);
  });

  it("rejects empty delegate_id", async () => {
    await expect(
      decode(DelegateBodySchema)({
        delegate_id: "",
        agent: "child",
        input: null,
      }),
    ).rejects.toThrow();
  });
});

describe("JobEventPayloadSchema (Effect Schema)", () => {
  it("accepts the envelope-level payload shape", async () => {
    const input = {
      kind: "log",
      ts: "2026-05-16T00:00:00Z",
      body: { level: "info", message: "x" },
    };
    await expect(decode(JobEventPayloadSchema)(input)).resolves.toEqual(input);
  });

  it("accepts a vendor kind with arbitrary body", async () => {
    const input = {
      kind: "x-vendor.acme.confidence",
      ts: "2026-05-16T00:00:00Z",
      body: { score: 0.87 },
    };
    await expect(decode(JobEventPayloadSchema)(input)).resolves.toEqual(input);
  });

  it("rejects empty kind / ts", async () => {
    await expect(
      decode(JobEventPayloadSchema)({ kind: "", ts: "now", body: {} }),
    ).rejects.toThrow();
    await expect(
      decode(JobEventPayloadSchema)({ kind: "log", ts: "", body: {} }),
    ).rejects.toThrow();
  });

  it("decodes the docs/guides examples through the Effect schema", () => {
    const inputs = [
      {
        kind: "log",
        ts: "t",
        body: { level: "info", message: "x" },
      },
      {
        kind: "metric",
        ts: "t",
        body: { name: "tokens.in", value: 1284, unit: "tokens" },
      },
      {
        kind: "artifact_ref",
        ts: "t",
        body: {
          uri: "s3://reports/r.md",
          content_type: "text/markdown",
          byte_size: 11_482,
          sha256: "abc",
        },
      },
      {
        kind: "progress",
        ts: "t",
        body: { current: 1, total: 3, units: "urls" },
      },
    ];
    for (const input of inputs) {
      expect(() =>
        Schema.decodeUnknownSync(JobEventPayloadSchema)(input),
      ).not.toThrow();
    }
  });
});

describe("parseJobEventBody — reserved kind dispatch", () => {
  it("validates `log` bodies through LogPayloadSchema", () => {
    expect(parseJobEventBody("log", { level: "info", message: "ok" })).toEqual({
      level: "info",
      message: "ok",
    });
    expect(() =>
      parseJobEventBody("log", { level: "verbose", message: "x" }),
    ).toThrow();
  });

  it("validates `metric` bodies through MetricPayloadSchema", () => {
    expect(parseJobEventBody("metric", { name: "x", value: 1 })).toEqual({
      name: "x",
      value: 1,
    });
    expect(() => parseJobEventBody("metric", { name: "", value: 1 })).toThrow();
  });

  it("validates `artifact_ref` bodies through ArtifactRefSchema", () => {
    const body = { uri: "s3://b/k", content_type: "text/plain" };
    expect(parseJobEventBody("artifact_ref", body)).toEqual(body);
    expect(() =>
      parseJobEventBody("artifact_ref", { uri: "", content_type: "x" }),
    ).toThrow();
  });

  it("validates `progress` bodies", () => {
    expect(parseJobEventBody("progress", { current: 1 })).toEqual({
      current: 1,
    });
    expect(() => parseJobEventBody("progress", { current: -1 })).toThrow();
  });

  it("validates `result_chunk` bodies", () => {
    const body = {
      result_id: "r-1",
      chunk_seq: 0,
      data: "x",
      encoding: "utf8" as const,
      more: true,
    };
    expect(parseJobEventBody("result_chunk", body)).toEqual(body);
  });

  it("passes vendor kinds through unchecked", () => {
    const body = { score: 0.87, extra: { anything: true } };
    expect(parseJobEventBody("x-vendor.acme.confidence", body)).toBe(body);
  });

  it("passes unknown kinds through unchecked (caller treats as opaque per §15)", () => {
    const body = { totally: "unknown" };
    expect(parseJobEventBody("not_reserved", body)).toBe(body);
  });

  it("validates every reserved kind in RESERVED_EVENT_KINDS", () => {
    // Sanity check the exhaustiveness of the decoder map: every entry in
    // RESERVED_EVENT_KINDS must have a dispatch arm. Bad input is rejected
    // by the kind-specific decoder; we test with empty body and assert it
    // throws (no kind accepts `{}` as a valid body except `tool_result`).
    for (const kind of RESERVED_EVENT_KINDS) {
      if (kind === "tool_result") continue;
      expect(
        () => parseJobEventBody(kind, {}),
        `kind=${kind} should reject empty body`,
      ).toThrow();
    }
    // `tool_result` does accept an empty body for void tools, but rejects
    // when call_id is missing.
    expect(parseJobEventBody("tool_result", { call_id: "x" })).toEqual({
      call_id: "x",
    });
  });
});

describe("kind helpers", () => {
  it("isReservedEventKind narrows reserved kinds", () => {
    for (const kind of RESERVED_EVENT_KINDS) {
      expect(isReservedEventKind(kind)).toBe(true);
    }
    expect(isReservedEventKind("x-vendor.acme.thing")).toBe(false);
    expect(isReservedEventKind("custom")).toBe(false);
  });

  it("isVendorEventKind matches the x-vendor.* prefix", () => {
    expect(isVendorEventKind("x-vendor.acme.confidence")).toBe(true);
    expect(isVendorEventKind("x-vendor.foo")).toBe(true);
    expect(isVendorEventKind("vendor.acme.thing")).toBe(false);
    expect(isVendorEventKind("log")).toBe(false);
  });
});
