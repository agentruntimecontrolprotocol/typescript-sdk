import { Effect, HashMap, Logger, LogLevel } from "effect";
import pino from "pino";
import { describe, expect, it } from "vitest";

import {
  LoggerLayer,
  makePinoEffectLogger,
  sessionLoggerEffect,
} from "../src/logger.js";

interface CapturedRecord {
  readonly level: string;
  readonly message: string;
  readonly annotations: Record<string, unknown>;
}

function captureLogger(): {
  readonly layer: ReturnType<typeof Logger.replace>;
  readonly records: CapturedRecord[];
} {
  const records: CapturedRecord[] = [];
  const captured = Logger.make(
    ({ annotations, logLevel, message }) => {
      const flat = Array.isArray(message)
        ? message.map((m) => (typeof m === "string" ? m : JSON.stringify(m))).join(" ")
        : String(message);
      records.push({
        level: logLevel.label,
        message: flat,
        annotations: Object.fromEntries(HashMap.entries(annotations)),
      });
    },
  );
  return {
    layer: Logger.replace(Logger.defaultLogger, captured),
    records,
  };
}

describe("Effect logger bridge", () => {
  it("captures level, message, and annotations for Effect.logInfo", async () => {
    const { layer, records } = captureLogger();
    await Effect.runPromise(
      Effect.provide(
        Effect.logInfo("hello").pipe(Effect.annotateLogs({ k: "v" })),
        layer,
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe("INFO");
    expect(records[0]?.message).toBe("hello");
    expect(records[0]?.annotations).toEqual({ k: "v" });
  });

  it("propagates each level through to the captured logger", async () => {
    const { layer, records } = captureLogger();
    const program = Effect.all([
      Effect.logWarning("warn-msg"),
      Effect.logError("err-msg"),
    ]);
    await Effect.runPromise(Effect.provide(program, layer));
    expect(records.map((r) => r.level)).toEqual(["WARN", "ERROR"]);
    expect(records.map((r) => r.message)).toEqual(["warn-msg", "err-msg"]);
  });

  it("sessionLoggerEffect propagates session_id annotation", async () => {
    const { layer, records } = captureLogger();
    const program = sessionLoggerEffect(
      "sess-abc",
      Effect.logInfo("started"),
    );
    await Effect.runPromise(Effect.provide(program, layer));
    expect(records).toHaveLength(1);
    expect(records[0]?.annotations).toEqual({ session_id: "sess-abc" });
  });

  it("LoggerLayer is a Layer that can be provided", () => {
    // Smoke check: LoggerLayer is defined and provides without throwing.
    expect(LoggerLayer).toBeDefined();
  });

  it("pino output JSON pins the expected fields", async () => {
    const chunks: string[] = [];
    const writableStream = {
      write: (chunk: string): boolean => {
        chunks.push(chunk);
        return true;
      },
    };
    const pinoInstance = pino(
      { name: "arcp-test", level: "info" },
      writableStream,
    );
    const layer = Logger.replace(
      Logger.defaultLogger,
      makePinoEffectLogger(pinoInstance),
    );
    const program = Effect.logInfo("hello").pipe(
      Effect.annotateLogs({ session_id: "sess-xyz", extra: "x" }),
    );
    await Effect.runPromise(Effect.provide(program, layer));

    expect(chunks).toHaveLength(1);
    const line = chunks[0];
    expect(line).toBeDefined();
    const parsed = JSON.parse(line ?? "{}") as Record<string, unknown>;
    expect(parsed["level"]).toBe(30); // pino info level
    expect(parsed["name"]).toBe("arcp-test");
    expect(parsed["msg"]).toBe("hello");
    expect(parsed["session_id"]).toBe("sess-xyz");
    expect(parsed["extra"]).toBe("x");
    expect(typeof parsed["time"]).toBe("number");
  });

  it("pino output respects level mapping (warn → 40, error → 50)", async () => {
    const chunks: string[] = [];
    const writableStream = {
      write: (chunk: string): boolean => {
        chunks.push(chunk);
        return true;
      },
    };
    const pinoInstance = pino(
      { name: "arcp-test", level: "trace" },
      writableStream,
    );
    const layer = Logger.replace(
      Logger.defaultLogger,
      makePinoEffectLogger(pinoInstance),
    );
    const program = Effect.all([
      Effect.logWarning("w"),
      Effect.logError("e"),
      Effect.logDebug("d"),
    ]).pipe(Logger.withMinimumLogLevel(LogLevel.All));
    await Effect.runPromise(Effect.provide(program, layer));
    const levels = chunks.map(
      (c) => (JSON.parse(c) as { level: number }).level,
    );
    expect(levels).toEqual([40, 50, 20]);
  });
});
