import { Effect, Logger } from "effect";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { makePinoEffectLogger, sessionLogger, silentLogger } from "../src/logger.js";

describe("logger coverage", () => {
  it("creates session children and silent logger", () => {
    const child = sessionLogger(silentLogger, "sess_1");
    expect(child).toBeDefined();
  });

  it("maps all effect log levels through the pino bridge", async () => {
    const chunks: string[] = [];
    const writableStream = {
      write: (chunk: string): boolean => {
        chunks.push(chunk);
        return true;
      },
    };
    const instance = pino({ name: "arcp-test", level: "trace" }, writableStream);
    const logger = Logger.replace(
      Logger.defaultLogger,
      makePinoEffectLogger(instance),
    );
    await Effect.runPromise(
      Effect.provide(
        Effect.all([
          Effect.logDebug("debug"),
          Effect.logInfo(["hello", { a: 1 }]),
          Effect.logWarning("warn"),
          Effect.logError("error"),
          Effect.logFatal("fatal"),
        ]).pipe(Effect.annotateLogs({ session_id: "sess_1" })),
        logger,
      ),
    );
    expect(chunks.length).toBeGreaterThan(0);
    const parsed = chunks.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.some((row) => row["session_id"] === "sess_1")).toBe(true);
  });
});
