import { z } from "zod";

import { messageEnvelope } from "../envelope.js";
import { type ErrorPayload, ErrorPayloadSchema } from "../errors.js";

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
  "cost.budget",
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

/**
 * v1.1 §9.5 lease constraints. Currently carries only `expires_at` (ISO 8601
 * UTC with `Z` suffix), which sets a hard upper bound on the lease's lifetime.
 *
 * The schema validates `expires_at` is a non-empty string. Stricter checks
 * (UTC, future-dated) are enforced at submit time by the runtime.
 */
export const LeaseConstraintsSchema = z.object({
  expires_at: z.string().min(1).optional(),
});
export type LeaseConstraints = z.infer<typeof LeaseConstraintsSchema>;

// ---------------------------------------------------------------------------
// v1.1 §7.5 agent versioning helpers.
// ---------------------------------------------------------------------------

const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const AGENT_VERSION_REGEX = /^[a-zA-Z0-9.+_-]+$/;

/** Parsed `agent` string. `version` is null when the input is a bare name. */
export interface ParsedAgentRef {
  name: string;
  version: string | null;
}

/**
 * Parse an `agent` identifier per v1.1 §7.5:
 *
 *     agent   ::= name | name "@" version
 *     name    ::= [a-z0-9][a-z0-9._-]*
 *     version ::= [a-zA-Z0-9.+_-]+
 *
 * Returns `{ name, version }`. Throws if either part fails its grammar.
 */
export function parseAgentRef(input: string): ParsedAgentRef {
  const at = input.indexOf("@");
  if (at === -1) {
    if (!AGENT_NAME_REGEX.test(input)) {
      throw new Error(`Invalid agent name "${input}"`);
    }
    return { name: input, version: null };
  }
  const name = input.slice(0, at);
  const version = input.slice(at + 1);
  if (!AGENT_NAME_REGEX.test(name)) {
    throw new Error(`Invalid agent name "${name}" in "${input}"`);
  }
  if (!AGENT_VERSION_REGEX.test(version)) {
    throw new Error(`Invalid agent version "${version}" in "${input}"`);
  }
  return { name, version };
}

/** Format a parsed agent ref back to its wire string. */
export function formatAgentRef(ref: ParsedAgentRef): string {
  return ref.version === null ? ref.name : `${ref.name}@${ref.version}`;
}

// ---------------------------------------------------------------------------
// v1.1 §9.6 cost.budget helpers.
// ---------------------------------------------------------------------------

/** Parsed `cost.budget` amount pattern (`currency:decimal`). */
export interface ParsedBudgetAmount {
  currency: string;
  amount: number;
}

const BUDGET_AMOUNT_REGEX = /^([A-Za-z][A-Za-z0-9_-]*):(\d+(?:\.\d+)?)$/;

/**
 * Parse a `cost.budget` amount string per v1.1 §9.6:
 *
 *     amount   ::= currency ":" decimal
 *     currency ::= "USD" | "EUR" | "credits" | <runtime-defined>
 *     decimal  ::= digits ( "." digits )?
 */
export function parseBudgetAmount(input: string): ParsedBudgetAmount {
  const m = BUDGET_AMOUNT_REGEX.exec(input);
  if (m === null) {
    throw new Error(`Invalid cost.budget amount "${input}"`);
  }
  const currency = m[1];
  const rawAmount = m[2];
  if (currency === undefined || rawAmount === undefined) {
    throw new Error(`Invalid cost.budget amount "${input}"`);
  }
  const amount = Number.parseFloat(rawAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid cost.budget amount "${input}"`);
  }
  return { currency, amount };
}

// ---------------------------------------------------------------------------
// Job submit / accepted (§7.1)
// ---------------------------------------------------------------------------

export const JobSubmitPayloadSchema = z.object({
  agent: z.string().min(1),
  input: z.unknown(),
  lease_request: LeaseSchema.optional(),
  /** v1.1 §9.5 — time bound for the lease. */
  lease_constraints: LeaseConstraintsSchema.optional(),
  idempotency_key: z.string().min(1).optional(),
  max_runtime_sec: z.number().int().positive().optional(),
});
export type JobSubmitPayload = z.infer<typeof JobSubmitPayloadSchema>;

/**
 * Initial per-currency budget counters echoed in `job.accepted` when the
 * lease includes `cost.budget`. Keys are currency identifiers (e.g., `USD`);
 * values are positive decimals (§9.6).
 */
export const JobBudgetSchema = z.record(z.string().min(1), z.number());
export type JobBudget = z.infer<typeof JobBudgetSchema>;

export const JobAcceptedPayloadSchema = z.object({
  job_id: z.string().min(1),
  /** Resolved `name@version` when v1.1 agent_versions is in use; bare name otherwise. */
  agent: z.string().min(1).optional(),
  lease: LeaseSchema,
  /** v1.1 §9.5 — echoed lease constraints. */
  lease_constraints: LeaseConstraintsSchema.optional(),
  /** v1.1 §9.6 — initial budget counters, when `cost.budget` is in the lease. */
  budget: JobBudgetSchema.optional(),
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
  // v1.1 §8.2
  "progress",
  "result_chunk",
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
  /** v1.1 §9.4/§9.5 — child lease bound; MUST NOT exceed parent's. */
  lease_constraints: LeaseConstraintsSchema.optional(),
});

/**
 * v1.1 §8.2.1 `progress` body.
 *
 * `current` MUST be non-negative; `total` (if present) is the upper bound.
 * Advisory; the protocol does not act on progress events.
 */
export const ProgressBodySchema = z.object({
  current: z.number().nonnegative(),
  total: z.number().nonnegative().optional(),
  units: z.string().min(1).optional(),
  message: z.string().optional(),
});
export type ProgressBody = z.infer<typeof ProgressBodySchema>;

/**
 * v1.1 §8.4 `result_chunk` body. Chunks for one `result_id` are emitted in
 * order; `more: false` marks the final chunk. The terminating `job.result`
 * MUST carry `result_id`.
 */
export const ResultChunkBodySchema = z.object({
  result_id: z.string().min(1),
  chunk_seq: z.number().int().nonnegative(),
  data: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  more: z.boolean(),
});
export type ResultChunkBody = z.infer<typeof ResultChunkBodySchema>;

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
                : K extends "progress"
                  ? ProgressBody
                  : K extends "result_chunk"
                    ? ResultChunkBody
                    : unknown;
export function parseJobEventBody(kind: string, body: unknown): unknown;
export function parseJobEventBody(kind: string, body: unknown): unknown {
  switch (kind) {
    case "log": {
      return LogPayloadSchema.parse(body);
    }
    case "thought": {
      return ThoughtBodySchema.parse(body);
    }
    case "tool_call": {
      return ToolCallBodySchema.parse(body);
    }
    case "tool_result": {
      return ToolResultBodySchema.parse(body);
    }
    case "status": {
      return StatusBodySchema.parse(body);
    }
    case "metric": {
      return MetricPayloadSchema.parse(body);
    }
    case "artifact_ref": {
      return ArtifactRefBodySchema.parse(body);
    }
    case "delegate": {
      return DelegateBodySchema.parse(body);
    }
    case "progress": {
      return ProgressBodySchema.parse(body);
    }
    case "result_chunk": {
      return ResultChunkBodySchema.parse(body);
    }
    default: {
      return body;
    }
  }
}

// ---------------------------------------------------------------------------
// Terminal events: job.result (success) and job.error (failure variants).
// ---------------------------------------------------------------------------

/**
 * v1.0 `job.result` carries the inline `result`. v1.1 §8.4 adds
 * `result_id`/`result_size` when the result was streamed via
 * `result_chunk` events. The two modes MUST NOT mix in the same job.
 */
export const JobResultPayloadSchema = z.object({
  final_status: z.literal("success"),
  summary: z.string().optional(),
  result: z.unknown().optional(),
  /** v1.1 §8.4 — references the assembled streamed result. */
  result_id: z.string().min(1).optional(),
  /** v1.1 §8.4 — byte length of the streamed result. */
  result_size: z.number().int().nonnegative().optional(),
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
    ...(p.retryable === undefined ? {} : { retryable: p.retryable }),
    ...(p.details === undefined ? {} : { details: p.details }),
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

// ---------------------------------------------------------------------------
// v1.1 §7.6 subscribe / subscribed / unsubscribe envelopes.
// ---------------------------------------------------------------------------

export const JobSubscribePayloadSchema = z.object({
  job_id: z.string().min(1),
  from_event_seq: z.number().int().nonnegative().optional(),
  history: z.boolean().optional(),
});
export type JobSubscribePayload = z.infer<typeof JobSubscribePayloadSchema>;

export const JobSubscribedPayloadSchema = z.object({
  job_id: z.string().min(1),
  current_status: JobStateSchema,
  agent: z.string().min(1),
  lease: LeaseSchema,
  lease_constraints: LeaseConstraintsSchema.optional(),
  budget: JobBudgetSchema.optional(),
  parent_job_id: z.string().nullable().optional(),
  trace_id: z.string().optional(),
  subscribed_from: z.number().int().nonnegative(),
  replayed: z.boolean(),
});
export type JobSubscribedPayload = z.infer<typeof JobSubscribedPayloadSchema>;

export const JobUnsubscribePayloadSchema = z.object({
  job_id: z.string().min(1),
});
export type JobUnsubscribePayload = z.infer<typeof JobUnsubscribePayloadSchema>;

export const JobSubscribeEnvelopeSchema = messageEnvelope(
  "job.subscribe",
  JobSubscribePayloadSchema,
).extend({ session_id: z.string().min(1) });

export const JobSubscribedEnvelopeSchema = messageEnvelope(
  "job.subscribed",
  JobSubscribedPayloadSchema,
).extend({ session_id: z.string().min(1), job_id: z.string().min(1) });

export const JobUnsubscribeEnvelopeSchema = messageEnvelope(
  "job.unsubscribe",
  JobUnsubscribePayloadSchema,
).extend({ session_id: z.string().min(1) });

export const EXECUTION_ENVELOPES = [
  JobSubmitEnvelopeSchema,
  JobAcceptedEnvelopeSchema,
  JobCancelEnvelopeSchema,
  JobEventEnvelopeSchema,
  JobResultEnvelopeSchema,
  JobErrorEnvelopeSchema,
  JobSubscribeEnvelopeSchema,
  JobSubscribedEnvelopeSchema,
  JobUnsubscribeEnvelopeSchema,
] as const;

// Re-export ArtifactRefSchema for convenience even though it's in artifacts.ts.

export { ArtifactRefSchema } from "./artifacts.js";
