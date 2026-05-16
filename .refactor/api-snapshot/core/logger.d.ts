import { type Logger as PinoLogger } from "pino";
/** Re-export of pino's Logger type for downstream consumers. */
export type Logger = PinoLogger;
/**
 * Default root logger. Honors `ARCP_LOG_LEVEL` (default `info`).
 *
 * Tests use {@link silentLogger} to suppress output; production code accepts
 * a logger via constructor injection so it can be wired to the host's pino
 * configuration.
 */
export declare const rootLogger: Logger;
/** Convenience: create a child logger bound to a session. */
export declare function sessionLogger(parent: Logger, sessionId: string): Logger;
/** A no-op logger for use in tests where structured output would be noise. */
export declare const silentLogger: Logger;
//# sourceMappingURL=logger.d.ts.map