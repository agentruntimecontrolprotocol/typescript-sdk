import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  LOG_LEVELS,
  LogLevelSchema,
  LogPayloadSchema,
  MetricPayloadSchema,
} from "@agentruntimecontrolprotocol/core";

// Pin the JSON shapes accepted/rejected by the Effect-`Schema` definitions
// of the §8.2 `log` and `metric` event-kind bodies. The legacy zod twins
// (`*ZodSchema`) still feed `events.ts::RESERVED_EVENT_SCHEMAS` so a
// behavior drift between zod and Effect surfaces here.

const decodeLog = (input: unknown) =>
  Effect.runPromise(Schema.decodeUnknown(LogPayloadSchema)(input));
const encodeLog = (input: Schema.Schema.Type<typeof LogPayloadSchema>) =>
  Effect.runPromise(Schema.encode(LogPayloadSchema)(input));

const decodeMetric = (input: unknown) =>
  Effect.runPromise(Schema.decodeUnknown(MetricPayloadSchema)(input));
const encodeMetric = (input: Schema.Schema.Type<typeof MetricPayloadSchema>) =>
  Effect.runPromise(Schema.encode(MetricPayloadSchema)(input));

const decodeLevel = (input: unknown) =>
  Effect.runPromise(Schema.decodeUnknown(LogLevelSchema)(input));

describe("LogLevelSchema (Effect Schema)", () => {
  it("accepts every member of LOG_LEVELS", async () => {
    for (const level of LOG_LEVELS) {
      await expect(decodeLevel(level)).resolves.toBe(level);
    }
  });

  it("rejects unknown levels", async () => {
    await expect(decodeLevel("verbose")).rejects.toThrow();
    await expect(decodeLevel("INFO")).rejects.toThrow();
  });
});

describe("LogPayloadSchema (Effect Schema)", () => {
  describe("decode — accepts", () => {
    it("accepts a minimal log body", async () => {
      const input = { level: "info" as const, message: "hello" };
      await expect(decodeLog(input)).resolves.toEqual(input);
    });

    it("accepts the docs/guides/job-events.md log shape", async () => {
      // docs: `log` body `{ level, message, attributes? }`
      const input = {
        level: "warn" as const,
        message: "tokens.in exceeded budget",
        attributes: { agent: "summarizer", retry: 2 },
      };
      await expect(decodeLog(input)).resolves.toEqual(input);
    });

    it("accepts each LOG_LEVELS member as the level", async () => {
      for (const level of LOG_LEVELS) {
        const input = { level, message: "x" };
        await expect(decodeLog(input)).resolves.toEqual(input);
      }
    });
  });

  describe("decode — rejects", () => {
    it("rejects empty message (zod parity: .min(1))", async () => {
      await expect(decodeLog({ level: "info", message: "" })).rejects.toThrow();
    });

    it("rejects unknown level", async () => {
      await expect(
        decodeLog({ level: "notice", message: "x" }),
      ).rejects.toThrow();
    });

    it("rejects missing required fields", async () => {
      await expect(decodeLog({ level: "info" })).rejects.toThrow();
      await expect(decodeLog({ message: "x" })).rejects.toThrow();
    });
  });

  describe("encode — round-trip", () => {
    it("preserves the input shape through decode → encode", async () => {
      const input = {
        level: "error" as const,
        message: "boom",
        attributes: { code: "E_GENERIC", count: 3 },
      };
      const decoded = await decodeLog(input);
      const encoded = await encodeLog(decoded);
      expect(encoded).toEqual(input);
    });
  });
});

describe("MetricPayloadSchema (Effect Schema)", () => {
  describe("decode — accepts", () => {
    it("accepts a minimal metric body", async () => {
      const input = { name: "tokens.in", value: 1284 };
      await expect(decodeMetric(input)).resolves.toEqual(input);
    });

    it("accepts the docs/guides/job-events.md metric shape (unit + dims)", async () => {
      // docs example: `await ctx.metric({ name: "tokens.in", value: 1284, unit: "tokens" });`
      const input = {
        name: "tokens.in",
        value: 1284,
        unit: "tokens",
        dims: { agent: "summarizer", model: "gpt-4o" },
      };
      await expect(decodeMetric(input)).resolves.toEqual(input);
    });

    it("accepts negative values (zod parity: no sign constraint)", async () => {
      const input = { name: "delta.temp", value: -3.14 };
      await expect(decodeMetric(input)).resolves.toEqual(input);
    });
  });

  describe("decode — rejects", () => {
    it("rejects empty name (zod parity: .min(1))", async () => {
      await expect(decodeMetric({ name: "", value: 1 })).rejects.toThrow();
    });

    it("rejects empty unit (zod parity: .min(1) when present)", async () => {
      await expect(
        decodeMetric({ name: "x", value: 1, unit: "" }),
      ).rejects.toThrow();
    });

    it("rejects non-string dim values", async () => {
      await expect(
        decodeMetric({ name: "x", value: 1, dims: { tag: 5 } }),
      ).rejects.toThrow();
    });

    it("rejects missing required fields", async () => {
      await expect(decodeMetric({ name: "x" })).rejects.toThrow();
      await expect(decodeMetric({ value: 1 })).rejects.toThrow();
    });
  });

  describe("encode — round-trip", () => {
    it("preserves the input shape through decode → encode", async () => {
      const input = {
        name: "latency.ms",
        value: 42.5,
        unit: "ms",
        dims: { region: "us-east-1" },
      };
      const decoded = await decodeMetric(input);
      const encoded = await encodeMetric(decoded);
      expect(encoded).toEqual(input);
    });
  });
});
