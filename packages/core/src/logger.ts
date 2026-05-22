// Logger module — preserves the legacy pino-shaped `Logger` interface used
// throughout `@agentruntimecontrolprotocol/client` and `@agentruntimecontrolprotocol/runtime`, and bridges Effect's
// `Effect.log*` API onto the same pino instance so observability output
// stays byte-identical regardless of which surface produced the line.
//
// Legacy callers keep using `rootLogger`, `sessionLogger`, `silentLogger`.
// Effect-aware callers run their program with `Effect.provide(LoggerLayer)`
// (or `sessionLoggerEffect(id)` for a session-scoped scope) and call
// `Effect.logInfo/Warning/Error/...`. The custom `PinoLogger` translates
// each `LogRecord` back into `pinoInstance[level](annotationObj, message)`.

import { Effect, HashMap, Logger as EffectLogger, type LogLevel } from "effect";
import pino, { type Logger as PinoLoggerType } from "pino";

/** Re-export of pino's Logger type for downstream consumers. */
export type Logger = PinoLoggerType;

/**
 * Default root logger. Honors `ARCP_LOG_LEVEL` (default `info`).
 *
 * Tests use {@link silentLogger} to suppress output; production code accepts
 * a logger via constructor injection so it can be wired to the host's pino
 * configuration.
 */
export const rootLogger: Logger = pino({
  name: "arcp",
  level: process.env["ARCP_LOG_LEVEL"] ?? "info",
});

/** Convenience: create a child logger bound to a session. */
export function sessionLogger(parent: Logger, sessionId: string): Logger {
  return parent.child({ session_id: sessionId });
}

/** A no-op logger for use in tests where structured output would be noise. */
export const silentLogger: Logger = pino({ level: "silent" });

// --- Effect bridge ----------------------------------------------------------

/**
 * Map an Effect `LogLevel` label to the matching pino method name. Effect's
 * labels (`FATAL`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`, `ALL`, `NONE`)
 * mostly overlap pino's. `ALL` and `NONE` are gate-only sentinels — if the
 * logger is ever invoked with them, we fall back to `info` so we never drop
 * a record silently.
 */
type PinoMethod = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const PINO_METHOD_BY_LABEL: Record<LogLevel.LogLevel["label"], PinoMethod> = {
  ALL: "trace",
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  FATAL: "fatal",
  OFF: "info",
};

function pinoMethodFor(level: LogLevel.LogLevel): PinoMethod {
  return PINO_METHOD_BY_LABEL[level.label];
}

/**
 * Flatten Effect's `message` field into a single string. `Effect.logInfo`
 * accepts varargs which arrive as an array; primitives are stringified, and
 * non-string values are JSON-encoded to keep the pino `msg` field a string
 * (matching what `pinoInstance.info(obj, "text")` produces today).
 */
function stringifyPart(part: unknown): string {
  if (typeof part === "string") return part;
  if (typeof part === "number" || typeof part === "boolean")
    return String(part);
  return JSON.stringify(part);
}

function formatMessage(message: unknown): string {
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map(stringifyPart).join(" ");
  return stringifyPart(message);
}

/**
 * Build a custom Effect `Logger` that writes through a pino instance. The
 * resulting log line has the same JSON shape (`level`, `time`, `name`,
 * `msg`, plus annotation keys) as a direct `pinoInstance.info(obj, msg)`
 * call — observability dashboards keyed on those fields keep working.
 */
export function makePinoEffectLogger(
  pinoInstance: Logger,
): EffectLogger.Logger<unknown, void> {
  return EffectLogger.make(({ annotations, logLevel, message }) => {
    const method = pinoMethodFor(logLevel);
    const annotationObj = Object.fromEntries(HashMap.entries(annotations));
    pinoInstance[method](annotationObj, formatMessage(message));
  });
}

/**
 * The default Effect `Logger` for ARCP: pipes records through {@link rootLogger}.
 */
export const PinoLogger: EffectLogger.Logger<unknown, void> =
  makePinoEffectLogger(rootLogger);

/**
 * Layer that replaces Effect's default logger with {@link PinoLogger}. Compose
 * with `Effect.provide(LoggerLayer)` at the program edge so every nested
 * `Effect.logInfo` (etc.) call inside that scope hits pino.
 */
export const LoggerLayer = EffectLogger.replace(
  EffectLogger.defaultLogger,
  PinoLogger,
);

/**
 * Run `effect` with the session's `session_id` annotation bound on every
 * log record emitted inside the scope — the Effect equivalent of
 * `sessionLogger(parent, sessionId).info(...)`.
 */
export function sessionLoggerEffect<A, E, R>(
  sessionId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.annotateLogs(effect, { session_id: sessionId });
}
