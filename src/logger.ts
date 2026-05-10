import pino, { type Logger as PinoLogger } from "pino";

/** Re-export of pino's Logger type for downstream consumers. */
export type Logger = PinoLogger;

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
