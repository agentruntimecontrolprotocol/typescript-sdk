import { z } from "zod";

// ARCP v1.0 §8.2 — body shapes used by `job.event` payloads for `kind=log`
// and `kind=metric`. There are no top-level telemetry envelopes in v1.0.

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "critical",
] as const;
export const LogLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/** §8.2 `log` event-kind body. */
export const LogPayloadSchema = z.object({
  level: LogLevelSchema,
  message: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type LogPayload = z.infer<typeof LogPayloadSchema>;

/** §8.2 `metric` event-kind body. */
export const MetricPayloadSchema = z.object({
  name: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1).optional(),
  dims: z.record(z.string(), z.string()).optional(),
});
export type MetricPayload = z.infer<typeof MetricPayloadSchema>;

export const TELEMETRY_ENVELOPES = [] as const;
