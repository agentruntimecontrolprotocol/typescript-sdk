import { z } from "zod";
import { messageEnvelope } from "../envelope.js";

// Generic event ----------------------------------------------------------

export const EventEmitPayloadSchema = z.object({
  name: z.string().min(1),
  attrs: z.record(z.string(), z.unknown()).optional(),
});
export type EventEmitPayload = z.infer<typeof EventEmitPayloadSchema>;

// Logs (§17.2) -----------------------------------------------------------

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "critical"] as const;
export const LogLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogPayloadSchema = z.object({
  level: LogLevelSchema,
  message: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type LogPayload = z.infer<typeof LogPayloadSchema>;

// Metrics (§17.3) --------------------------------------------------------

/**
 * Reserved metric names per §17.3.1. Runtimes producing the indicated concept
 * MUST use these names; non-standard variants MUST be namespaced.
 */
export const RESERVED_METRIC_NAMES = [
  "tokens.used",
  "cost.usd",
  "gpu.seconds",
  "tool.invocations",
  "latency.ms",
  "bytes.in",
  "bytes.out",
  "errors.total",
] as const;
export type ReservedMetricName = (typeof RESERVED_METRIC_NAMES)[number];

const RESERVED_METRIC_SET: ReadonlySet<string> = new Set(RESERVED_METRIC_NAMES);

/** Whether `name` is one of the reserved metric names from §17.3.1. */
export function isReservedMetricName(name: string): name is ReservedMetricName {
  return RESERVED_METRIC_SET.has(name);
}

export const MetricPayloadSchema = z
  .object({
    name: z.string().min(1),
    value: z.number(),
    unit: z.string().min(1),
    dims: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((p, ctx) => {
    // Enforce reserved units when a reserved name is used.
    const expected: Record<ReservedMetricName, string> = {
      "tokens.used": "tokens",
      "cost.usd": "usd",
      "gpu.seconds": "seconds",
      "tool.invocations": "count",
      "latency.ms": "ms",
      "bytes.in": "bytes",
      "bytes.out": "bytes",
      "errors.total": "count",
    };
    if (isReservedMetricName(p.name)) {
      const wantedUnit = expected[p.name];
      if (p.unit !== wantedUnit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unit"],
          message: `Reserved metric "${p.name}" requires unit "${wantedUnit}"`,
        });
      }
    }
  });
export type MetricPayload = z.infer<typeof MetricPayloadSchema>;

// Tracing (§17.1) --------------------------------------------------------

export const TraceSpanPayloadSchema = z.object({
  trace_id: z.string().min(1),
  span_id: z.string().min(1),
  parent_span_id: z.string().optional(),
  name: z.string().min(1),
  start_time: z.string(),
  duration_ms: z.number().nonnegative().optional(),
  status: z.enum(["unset", "ok", "error"]).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type TraceSpanPayload = z.infer<typeof TraceSpanPayloadSchema>;

// Envelopes -------------------------------------------------------------

export const EventEmitEnvelopeSchema = messageEnvelope("event.emit", EventEmitPayloadSchema);
export const LogEnvelopeSchema = messageEnvelope("log", LogPayloadSchema);
export const MetricEnvelopeSchema = messageEnvelope("metric", MetricPayloadSchema);
export const TraceSpanEnvelopeSchema = messageEnvelope("trace.span", TraceSpanPayloadSchema);

export const TELEMETRY_ENVELOPES = [
  EventEmitEnvelopeSchema,
  LogEnvelopeSchema,
  MetricEnvelopeSchema,
  TraceSpanEnvelopeSchema,
] as const;
