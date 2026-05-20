import { Schema } from "effect";

// ARCP v1.1 §8.2 — body shapes used by `job.event` payloads for `kind=log`
// and `kind=metric`. There are no top-level telemetry envelopes in v1.1.

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "critical",
] as const;

/**
 * Effect `Schema` literal-union over {@link LOG_LEVELS}.
 *
 * `Schema.Literal(...LOG_LEVELS)` decodes any of the six v1.0 log levels and
 * rejects everything else, matching the surface of the legacy
 * `z.enum(LOG_LEVELS)`. The inferred `LogLevel` type is identical
 * (`"trace" | "debug" | ... | "critical"`).
 */
export const LogLevelSchema = Schema.Literal(...LOG_LEVELS);
export type LogLevel = Schema.Schema.Type<typeof LogLevelSchema>;

/** §8.2 `log` event-kind body. */
export const LogPayloadSchema = Schema.Struct({
  level: LogLevelSchema,
  message: Schema.String.pipe(Schema.nonEmptyString()),
  attributes: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type LogPayload = Schema.Schema.Type<typeof LogPayloadSchema>;

/** §8.2 `metric` event-kind body. */
export const MetricPayloadSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.nonEmptyString()),
  value: Schema.Number,
  unit: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  dims: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String }),
  ),
});
export type MetricPayload = Schema.Schema.Type<typeof MetricPayloadSchema>;

export const TELEMETRY_ENVELOPES = [] as const;
