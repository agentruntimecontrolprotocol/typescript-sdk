import { Schema } from "effect";
import { z } from "zod";

import { messageEnvelope } from "../envelope.js";
import {
  ERROR_CODES,
  type ErrorPayload,
  ErrorPayloadSchema,
  InvalidRequestError,
} from "../errors.js";

import { JobEventPayloadZodSchema } from "./events.js";
import {
  LeaseConstraintsSchema,
  LeaseSchema,
} from "./lease-schema.js";

// ARCP v1.0 §7-§8 job-related envelopes.

export {
  isReservedCapabilityName,
  isValidCapabilityName,
  type Lease,
  LeaseConstraintsSchema,
  type LeaseConstraints,
  LeaseSchema,
  RESERVED_CAPABILITY_NAMES,
  type ReservedCapabilityName,
} from "./lease-schema.js";
export {
  type ArtifactRefBody,
  type DelegateBody,
  DelegateBodySchema,
  isReservedEventKind,
  isVendorEventKind,
  type JobEventPayload,
  JobEventPayloadSchema,
  JobEventPayloadZodSchema,
  type LogBody,
  type MetricBody,
  parseJobEventBody,
  type ProgressBody,
  ProgressBodySchema,
  RESERVED_EVENT_KINDS,
  type ReservedEventBodyMap,
  type ReservedEventKind,
  type ResultChunkBody,
  ResultChunkBodySchema,
  type StatusBody,
  StatusBodySchema,
  type ThoughtBody,
  ThoughtBodySchema,
  type ToolCallBody,
  ToolCallBodySchema,
  type ToolResultBody,
  ToolResultBodySchema,
} from "./events.js";

// v1.1 §7.5 agent versioning helpers.

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
      throw new InvalidRequestError(`Invalid agent name "${input}"`);
    }
    return { name: input, version: null };
  }
  const name = input.slice(0, at);
  const version = input.slice(at + 1);
  if (!AGENT_NAME_REGEX.test(name)) {
    throw new InvalidRequestError(`Invalid agent name "${name}" in "${input}"`);
  }
  if (!AGENT_VERSION_REGEX.test(version)) {
    throw new InvalidRequestError(
      `Invalid agent version "${version}" in "${input}"`,
    );
  }
  return { name, version };
}

/** Format a parsed agent ref back to its wire string. */
export function formatAgentRef(ref: ParsedAgentRef): string {
  return ref.version === null ? ref.name : `${ref.name}@${ref.version}`;
}

// v1.1 §9.6 cost.budget helpers.

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
    throw new InvalidRequestError(`Invalid cost.budget amount "${input}"`);
  }
  const currency = m[1];
  const rawAmount = m[2];
  if (currency === undefined || rawAmount === undefined) {
    throw new InvalidRequestError(`Invalid cost.budget amount "${input}"`);
  }
  const amount = Number.parseFloat(rawAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new InvalidRequestError(`Invalid cost.budget amount "${input}"`);
  }
  return { currency, amount };
}

// Job submit / accepted (§7.1)
//
// Effect-`Schema` payloads define the canonical wire shape. Zod twins
// (`*ZodSchema`) feed `messageEnvelope()` because the envelope layer is
// still zod-typed (slice #50). Branded fields stay zod-typed because the
// brands defined in `brands.ts` mirror `z.BRAND<B>`; an Effect brand would
// not be assignable to those aliases until the brands themselves migrate.

export const JobSubmitPayloadSchema = Schema.Struct({
  agent: Schema.String.pipe(Schema.nonEmptyString()),
  input: Schema.Unknown,
  lease_request: Schema.optional(Schema.Unknown),
  /** v1.1 §9.5 — time bound for the lease. */
  lease_constraints: Schema.optional(Schema.Unknown),
  idempotency_key: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  max_runtime_sec: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.positive()),
  ),
});

export const JobSubmitPayloadZodSchema = z.object({
  agent: z.string().min(1),
  input: z.unknown(),
  lease_request: LeaseSchema.optional(),
  lease_constraints: LeaseConstraintsSchema.optional(),
  idempotency_key: z.string().min(1).optional(),
  max_runtime_sec: z.number().int().positive().optional(),
});
export type JobSubmitPayload = z.infer<typeof JobSubmitPayloadZodSchema>;

/**
 * Initial per-currency budget counters echoed in `job.accepted` when the
 * lease includes `cost.budget`. Keys are currency identifiers (e.g., `USD`);
 * values are positive decimals (§9.6).
 */
// Note: Effect's `Schema.Record` silently drops keys that fail the key
// schema (so `{ "": 1 }` decodes to `{}`), whereas the zod twin rejects
// outright via `.min(1)` on the key. The wire-level rejection is preserved
// by the zod twin in `messageEnvelope()`; the Effect schema is the typed
// surface for in-process consumers, which do not produce empty-key records.
export const JobBudgetSchema = Schema.Record({
  key: Schema.String.pipe(Schema.nonEmptyString()),
  value: Schema.Number,
});
export const JobBudgetZodSchema = z.record(z.string().min(1), z.number());
export type JobBudget = z.infer<typeof JobBudgetZodSchema>;

export const JobAcceptedPayloadZodSchema = z.object({
  job_id: z.string().min(1).brand<"JobId">(),
  /** Resolved `name@version` when v1.1 agent_versions is in use; bare name otherwise. */
  agent: z.string().min(1).optional(),
  lease: LeaseSchema,
  /** v1.1 §9.5 — echoed lease constraints. */
  lease_constraints: LeaseConstraintsSchema.optional(),
  /** v1.1 §9.6 — initial budget counters, when `cost.budget` is in the lease. */
  budget: JobBudgetZodSchema.optional(),
  accepted_at: z.string().min(1),
  parent_job_id: z.string().brand<"JobId">().optional(),
  delegate_id: z.string().optional(),
  trace_id: z.string().brand<"TraceId">().optional(),
});
export type JobAcceptedPayload = z.infer<typeof JobAcceptedPayloadZodSchema>;

// Job cancel (§7.4)

export const JobCancelPayloadSchema = Schema.Struct({
  reason: Schema.optional(Schema.String),
});
export const JobCancelPayloadZodSchema = z.object({
  reason: z.string().optional(),
});
export type JobCancelPayload = z.infer<typeof JobCancelPayloadZodSchema>;

// Job lifecycle states (§7.3)

export const JOB_STATES = [
  "pending",
  "running",
  "success",
  "error",
  "cancelled",
  "timed_out",
] as const;
export const JobStateSchema = Schema.Literal(...JOB_STATES);
export const JobStateZodSchema = z.enum(JOB_STATES);
export type JobStateName = Schema.Schema.Type<typeof JobStateSchema>;

export const TERMINAL_JOB_STATES = [
  "success",
  "error",
  "cancelled",
  "timed_out",
] as const;
export type TerminalJobState = (typeof TERMINAL_JOB_STATES)[number];


// Terminal events: job.result (success) and job.error (failure variants).

/**
 * v1.0 `job.result` carries the inline `result`. v1.1 §8.4 adds
 * `result_id`/`result_size` when the result was streamed via
 * `result_chunk` events. The two modes MUST NOT mix in the same job.
 */
export const JobResultPayloadSchema = Schema.Struct({
  final_status: Schema.Literal("success"),
  summary: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
  /** v1.1 §8.4 — references the assembled streamed result. */
  result_id: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  /** v1.1 §8.4 — byte length of the streamed result. */
  result_size: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ),
});
export const JobResultPayloadZodSchema = z.object({
  final_status: z.literal("success"),
  summary: z.string().optional(),
  result: z.unknown().optional(),
  result_id: z.string().min(1).optional(),
  result_size: z.number().int().nonnegative().optional(),
});
export type JobResultPayload = z.infer<typeof JobResultPayloadZodSchema>;

export const JobErrorFinalStatusSchema = Schema.Literal(
  "error",
  "cancelled",
  "timed_out",
);
export const JobErrorFinalStatus = z.enum(["error", "cancelled", "timed_out"]);
export type JobErrorFinalStatus = z.infer<typeof JobErrorFinalStatus>;

export const JobErrorPayloadSchema = Schema.Struct({
  final_status: JobErrorFinalStatusSchema,
  code: Schema.Literal(...ERROR_CODES),
  message: Schema.String.pipe(Schema.nonEmptyString()),
  retryable: Schema.optional(Schema.Boolean),
  details: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export const JobErrorPayloadZodSchema = z.object({
  final_status: JobErrorFinalStatus,
  code: ErrorPayloadSchema.shape.code,
  message: ErrorPayloadSchema.shape.message,
  retryable: ErrorPayloadSchema.shape.retryable,
  details: ErrorPayloadSchema.shape.details,
});
export type JobErrorPayload = z.infer<typeof JobErrorPayloadZodSchema>;

/** Convenience: extract the error portion of a {@link JobErrorPayload}. */
export function jobErrorToErrorPayload(p: JobErrorPayload): ErrorPayload {
  return {
    code: p.code,
    message: p.message,
    ...(p.retryable === undefined ? {} : { retryable: p.retryable }),
    ...(p.details === undefined ? {} : { details: p.details }),
  };
}

// Envelopes — built with `messageEnvelope()` (zod-typed; slice #50).

export const JobSubmitEnvelopeSchema = messageEnvelope(
  "job.submit",
  JobSubmitPayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });

export const JobAcceptedEnvelopeSchema = messageEnvelope(
  "job.accepted",
  JobAcceptedPayloadZodSchema,
).extend({
  session_id: z.string().min(1).brand<"SessionId">(),
  job_id: z.string().min(1).brand<"JobId">(),
});

export const JobCancelEnvelopeSchema = messageEnvelope(
  "job.cancel",
  JobCancelPayloadZodSchema,
).extend({
  session_id: z.string().min(1).brand<"SessionId">(),
  job_id: z.string().min(1).brand<"JobId">(),
});

export const JobEventEnvelopeSchema = messageEnvelope(
  "job.event",
  JobEventPayloadZodSchema,
).extend({
  session_id: z.string().min(1).brand<"SessionId">(),
  job_id: z.string().min(1).brand<"JobId">(),
  event_seq: z.number().int().nonnegative().brand<"EventSeq">(),
});

export const JobResultEnvelopeSchema = messageEnvelope(
  "job.result",
  JobResultPayloadZodSchema,
).extend({
  session_id: z.string().min(1).brand<"SessionId">(),
  job_id: z.string().min(1).brand<"JobId">(),
  event_seq: z.number().int().nonnegative().brand<"EventSeq">(),
});

export const JobErrorEnvelopeSchema = messageEnvelope(
  "job.error",
  JobErrorPayloadZodSchema,
).extend({
  session_id: z.string().min(1).brand<"SessionId">(),
  job_id: z.string().min(1).brand<"JobId">(),
  event_seq: z.number().int().nonnegative().brand<"EventSeq">(),
});

// v1.1 §7.6 subscribe / subscribed / unsubscribe envelopes.

export const JobSubscribePayloadZodSchema = z.object({
  job_id: z.string().min(1).brand<"JobId">(),
  from_event_seq: z.number().int().nonnegative().brand<"EventSeq">().optional(),
  history: z.boolean().optional(),
});
export type JobSubscribePayload = z.infer<typeof JobSubscribePayloadZodSchema>;

export const JobSubscribedPayloadZodSchema = z.object({
  job_id: z.string().min(1).brand<"JobId">(),
  current_status: JobStateZodSchema,
  agent: z.string().min(1),
  lease: LeaseSchema,
  lease_constraints: LeaseConstraintsSchema.optional(),
  budget: JobBudgetZodSchema.optional(),
  parent_job_id: z.string().brand<"JobId">().nullable().optional(),
  trace_id: z.string().brand<"TraceId">().optional(),
  subscribed_from: z.number().int().nonnegative().brand<"EventSeq">(),
  replayed: z.boolean(),
});
export type JobSubscribedPayload = z.infer<
  typeof JobSubscribedPayloadZodSchema
>;

export const JobUnsubscribePayloadSchema = Schema.Struct({
  job_id: Schema.String.pipe(Schema.nonEmptyString()),
});
export const JobUnsubscribePayloadZodSchema = z.object({
  job_id: z.string().min(1).brand<"JobId">(),
});
export type JobUnsubscribePayload = z.infer<
  typeof JobUnsubscribePayloadZodSchema
>;

export const JobSubscribeEnvelopeSchema = messageEnvelope(
  "job.subscribe",
  JobSubscribePayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });

export const JobSubscribedEnvelopeSchema = messageEnvelope(
  "job.subscribed",
  JobSubscribedPayloadZodSchema,
).extend({
  session_id: z.string().min(1).brand<"SessionId">(),
  job_id: z.string().min(1).brand<"JobId">(),
});

export const JobUnsubscribeEnvelopeSchema = messageEnvelope(
  "job.unsubscribe",
  JobUnsubscribePayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });

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
