import { z } from "zod";
import { messageEnvelope } from "../envelope.js";
import { type ErrorPayload, ErrorPayloadSchema } from "../errors.js";
import { ArtifactRefSchema } from "./artifacts.js";
import { LogPayloadSchema, MetricPayloadSchema } from "./telemetry.js";

// ARCP v1.0 §7-§8 job-related envelopes.

// ---------------------------------------------------------------------------
// Lease shape (§9.1) — embedded on job.submit (request) and job.accepted
// (effective).
// ---------------------------------------------------------------------------

/**
 * §9.2 reserved capability namespaces.
 *
 * Any other capability name MUST start with `x-vendor.` per §15. The
 * runtime-side `validateLeaseCapabilityName` enforces this; the wire-shape
 * schema below allows any string and defers validation.
 */
export const RESERVED_CAPABILITY_NAMES = [
  "fs.read",
  "fs.write",
  "net.fetch",
  "tool.call",
  "agent.delegate",
] as const;
export type ReservedCapabilityName = (typeof RESERVED_CAPABILITY_NAMES)[number];

/** Whether `name` is a v1.0 reserved capability namespace. */
export function isReservedCapabilityName(
  name: string,
): name is ReservedCapabilityName {
  return (RESERVED_CAPABILITY_NAMES as readonly string[]).includes(name);
}

/** Whether `name` is a syntactically valid v1.0 capability name. */
export function isValidCapabilityName(name: string): boolean {
  if (isReservedCapabilityName(name)) return true;
  // x-vendor.<vendor>.<capability> per §15.
  return /^x-vendor(\.[a-z0-9_-]+){2,}$/.test(name);
}

/** §9.1 lease: capability → list of glob patterns. */
export const LeaseSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)),
);
export type Lease = z.infer<typeof LeaseSchema>;

// ---------------------------------------------------------------------------
// Job submit / accepted (§7.1)
// ---------------------------------------------------------------------------

export const JobSubmitPayloadSchema = z.object({
  agent: z.string().min(1),
  input: z.unknown(),
  lease_request: LeaseSchema.optional(),
  idempotency_key: z.string().min(1).optional(),
  max_runtime_sec: z.number().int().positive().optional(),
});
export type JobSubmitPayload = z.infer<typeof JobSubmitPayloadSchema>;

export const JobAcceptedPayloadSchema = z.object({
  job_id: z.string().min(1),
  lease: LeaseSchema,
  accepted_at: z.string().min(1),
  parent_job_id: z.string().optional(),
  delegate_id: z.string().optional(),
  trace_id: z.string().optional(),
});
export type JobAcceptedPayload = z.infer<typeof JobAcceptedPayloadSchema>;

// ---------------------------------------------------------------------------
// Job cancel (§7.4)
// ---------------------------------------------------------------------------

export const JobCancelPayloadSchema = z.object({
  reason: z.string().optional(),
});
export type JobCancelPayload = z.infer<typeof JobCancelPayloadSchema>;

// ---------------------------------------------------------------------------
// Job lifecycle states (§7.3)
// ---------------------------------------------------------------------------

export const JOB_STATES = [
  "pending",
  "running",
  "success",
  "error",
  "cancelled",
  "timed_out",
] as const;
export const JobStateSchema = z.enum(JOB_STATES);
export type JobStateName = z.infer<typeof JobStateSchema>;

export const TERMINAL_JOB_STATES = [
  "success",
  "error",
  "cancelled",
  "timed_out",
] as const;
export type TerminalJobState = (typeof TERMINAL_JOB_STATES)[number];

// ---------------------------------------------------------------------------
// Job event (§8) — eight reserved kinds + x-vendor.*
// ---------------------------------------------------------------------------

export const RESERVED_EVENT_KINDS = [
  "log",
  "thought",
  "tool_call",
  "tool_result",
  "status",
  "metric",
  "artifact_ref",
  "delegate",
] as const;
export type ReservedEventKind = (typeof RESERVED_EVENT_KINDS)[number];

export function isReservedEventKind(value: string): value is ReservedEventKind {
  return (RESERVED_EVENT_KINDS as readonly string[]).includes(value);
}

export function isVendorEventKind(value: string): boolean {
  return /^x-vendor\.[a-z0-9_.-]+$/.test(value);
}

const ThoughtBodySchema = z.object({
  text: z.string(),
});

const ToolCallBodySchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  call_id: z.string().min(1),
});

const ToolResultBodySchema = z
  .object({
    call_id: z.string().min(1),
    result: z.unknown().optional(),
    error: ErrorPayloadSchema.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.result === undefined && b.error === undefined) {
      // empty result for void tools is allowed
      return;
    }
    if (b.result !== undefined && b.error !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool_result body must not carry both `result` and `error`",
      });
    }
  });

const StatusBodySchema = z.object({
  phase: z.string().min(1),
  message: z.string().optional(),
});

const ArtifactRefBodySchema = z.object({
  uri: z.string().min(1),
  content_type: z.string().min(1),
  byte_size: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
});

const DelegateBodySchema = z.object({
  delegate_id: z.string().min(1),
  agent: z.string().min(1),
  input: z.unknown(),
  lease_request: LeaseSchema.optional(),
});

/**
 * Job event payload shape. `kind` is one of the eight reserved values OR a
 * vendor-prefixed string. `body` is validated when the kind matches a
 * reserved schema; vendor and unknown kinds get a permissive object body.
 */
export const JobEventPayloadSchema = z.object({
  kind: z.string().min(1),
  ts: z.string().min(1),
  body: z.unknown(),
});
export type JobEventPayload = z.infer<typeof JobEventPayloadSchema>;

export type LogBody = z.infer<typeof LogPayloadSchema>;
export type ThoughtBody = z.infer<typeof ThoughtBodySchema>;
export type ToolCallBody = z.infer<typeof ToolCallBodySchema>;
export type ToolResultBody = z.infer<typeof ToolResultBodySchema>;
export type StatusBody = z.infer<typeof StatusBodySchema>;
export type MetricBody = z.infer<typeof MetricPayloadSchema>;
export type ArtifactRefBody = z.infer<typeof ArtifactRefBodySchema>;
export type DelegateBody = z.infer<typeof DelegateBodySchema>;

/**
 * Parse a `job.event.payload.body` against the kind-specific schema.
 *
 * Unknown kinds (including `x-vendor.*`) return the raw body unchanged.
 * Reserved kinds throw on body schema mismatch.
 */
export function parseJobEventBody<K extends ReservedEventKind>(
  kind: K,
  body: unknown,
): K extends "log"
  ? LogBody
  : K extends "thought"
    ? ThoughtBody
    : K extends "tool_call"
      ? ToolCallBody
      : K extends "tool_result"
        ? ToolResultBody
        : K extends "status"
          ? StatusBody
          : K extends "metric"
            ? MetricBody
            : K extends "artifact_ref"
              ? ArtifactRefBody
              : K extends "delegate"
                ? DelegateBody
                : unknown;
export function parseJobEventBody(kind: string, body: unknown): unknown;
export function parseJobEventBody(kind: string, body: unknown): unknown {
  switch (kind) {
    case "log":
      return LogPayloadSchema.parse(body);
    case "thought":
      return ThoughtBodySchema.parse(body);
    case "tool_call":
      return ToolCallBodySchema.parse(body);
    case "tool_result":
      return ToolResultBodySchema.parse(body);
    case "status":
      return StatusBodySchema.parse(body);
    case "metric":
      return MetricPayloadSchema.parse(body);
    case "artifact_ref":
      return ArtifactRefBodySchema.parse(body);
    case "delegate":
      return DelegateBodySchema.parse(body);
    default:
      return body;
  }
}

// ---------------------------------------------------------------------------
// Terminal events: job.result (success) and job.error (failure variants).
// ---------------------------------------------------------------------------

export const JobResultPayloadSchema = z.object({
  final_status: z.literal("success"),
  summary: z.string().optional(),
  result: z.unknown().optional(),
});
export type JobResultPayload = z.infer<typeof JobResultPayloadSchema>;

export const JobErrorFinalStatus = z.enum(["error", "cancelled", "timed_out"]);
export type JobErrorFinalStatus = z.infer<typeof JobErrorFinalStatus>;

export const JobErrorPayloadSchema = z.object({
  final_status: JobErrorFinalStatus,
  code: ErrorPayloadSchema.shape.code,
  message: ErrorPayloadSchema.shape.message,
  retryable: ErrorPayloadSchema.shape.retryable,
  details: ErrorPayloadSchema.shape.details,
});
export type JobErrorPayload = z.infer<typeof JobErrorPayloadSchema>;

/** Convenience: extract the error portion of a {@link JobErrorPayload}. */
export function jobErrorToErrorPayload(p: JobErrorPayload): ErrorPayload {
  return {
    code: p.code,
    message: p.message,
    ...(p.retryable !== undefined ? { retryable: p.retryable } : {}),
    ...(p.details !== undefined ? { details: p.details } : {}),
  };
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

export const JobSubmitEnvelopeSchema = messageEnvelope(
  "job.submit",
  JobSubmitPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const JobAcceptedEnvelopeSchema = messageEnvelope(
  "job.accepted",
  JobAcceptedPayloadSchema,
).extend({ session_id: z.string().min(1), job_id: z.string().min(1) });

export const JobCancelEnvelopeSchema = messageEnvelope(
  "job.cancel",
  JobCancelPayloadSchema,
).extend({ session_id: z.string().min(1), job_id: z.string().min(1) });

export const JobEventEnvelopeSchema = messageEnvelope(
  "job.event",
  JobEventPayloadSchema,
).extend({
  session_id: z.string().min(1),
  job_id: z.string().min(1),
  event_seq: z.number().int().nonnegative(),
});

export const JobResultEnvelopeSchema = messageEnvelope(
  "job.result",
  JobResultPayloadSchema,
).extend({
  session_id: z.string().min(1),
  job_id: z.string().min(1),
  event_seq: z.number().int().nonnegative(),
});

export const JobErrorEnvelopeSchema = messageEnvelope(
  "job.error",
  JobErrorPayloadSchema,
).extend({
  session_id: z.string().min(1),
  job_id: z.string().min(1),
  event_seq: z.number().int().nonnegative(),
});

export const EXECUTION_ENVELOPES = [
  JobSubmitEnvelopeSchema,
  JobAcceptedEnvelopeSchema,
  JobCancelEnvelopeSchema,
  JobEventEnvelopeSchema,
  JobResultEnvelopeSchema,
  JobErrorEnvelopeSchema,
] as const;

// Re-export ArtifactRefSchema for convenience even though it's in artifacts.ts.
export { ArtifactRefSchema };
