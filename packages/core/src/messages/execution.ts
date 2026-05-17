import { Schema } from "effect";

import { messageEnvelope } from "../envelope.js";
import {
  ERROR_CODES,
  type ErrorPayload,
  InvalidRequestError,
} from "../errors.js";

import { JobEventPayloadSchema } from "./events.js";
import { LeaseConstraintsSchema, LeaseSchema } from "./lease-schema.js";

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

export const JobSubmitPayloadSchema = Schema.Struct({
  agent: Schema.String.pipe(Schema.nonEmptyString()),
  input: Schema.Unknown,
  lease_request: Schema.optional(LeaseSchema),
  /** v1.1 §9.5 — time bound for the lease. */
  lease_constraints: Schema.optional(LeaseConstraintsSchema),
  idempotency_key: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  max_runtime_sec: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.positive()),
  ),
});
export type JobSubmitPayload = Schema.Schema.Type<
  typeof JobSubmitPayloadSchema
>;

/**
 * Initial per-currency budget counters echoed in `job.accepted` when the
 * lease includes `cost.budget`. Keys are currency identifiers (e.g., `USD`);
 * values are positive decimals (§9.6).
 */
// Note: Effect's `Schema.Record` silently drops keys that fail the key
// schema (so `{ "": 1 }` decodes to `{}`).
export const JobBudgetSchema = Schema.mutable(
  Schema.Record({
    key: Schema.String.pipe(Schema.nonEmptyString()),
    value: Schema.Number,
  }),
);
export type JobBudget = Schema.Schema.Type<typeof JobBudgetSchema>;

export const JobAcceptedPayloadSchema = Schema.Struct({
  job_id: Schema.String.pipe(Schema.nonEmptyString()),
  /** Resolved `name@version` when v1.1 agent_versions is in use; bare name otherwise. */
  agent: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  lease: LeaseSchema,
  /** v1.1 §9.5 — echoed lease constraints. */
  lease_constraints: Schema.optional(LeaseConstraintsSchema),
  /** v1.1 §9.6 — initial budget counters, when `cost.budget` is in the lease. */
  budget: Schema.optional(JobBudgetSchema),
  accepted_at: Schema.String.pipe(Schema.nonEmptyString()),
  parent_job_id: Schema.optional(Schema.String),
  delegate_id: Schema.optional(Schema.String),
  trace_id: Schema.optional(Schema.String),
});
export type JobAcceptedPayload = Schema.Schema.Type<
  typeof JobAcceptedPayloadSchema
>;

// Job cancel (§7.4)

export const JobCancelPayloadSchema = Schema.Struct({
  reason: Schema.optional(Schema.String),
});
export type JobCancelPayload = Schema.Schema.Type<
  typeof JobCancelPayloadSchema
>;

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
export type JobResultPayload = Schema.Schema.Type<
  typeof JobResultPayloadSchema
>;

export const JobErrorFinalStatusSchema = Schema.Literal(
  "error",
  "cancelled",
  "timed_out",
);
export type JobErrorFinalStatus = Schema.Schema.Type<
  typeof JobErrorFinalStatusSchema
>;

export const JobErrorPayloadSchema = Schema.Struct({
  final_status: JobErrorFinalStatusSchema,
  code: Schema.Literal(...ERROR_CODES),
  message: Schema.String.pipe(Schema.nonEmptyString()),
  retryable: Schema.optional(Schema.Boolean),
  details: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type JobErrorPayload = Schema.Schema.Type<typeof JobErrorPayloadSchema>;

/** Convenience: extract the error portion of a {@link JobErrorPayload}. */
export function jobErrorToErrorPayload(p: JobErrorPayload): ErrorPayload {
  return {
    code: p.code,
    message: p.message,
    ...(p.retryable === undefined ? {} : { retryable: p.retryable }),
    ...(p.details === undefined ? {} : { details: p.details }),
  };
}

// Envelopes — built with `messageEnvelope()` (Effect Schema).

export const JobSubmitEnvelopeSchema = messageEnvelope(
  "job.submit",
  JobSubmitPayloadSchema,
);

export const JobAcceptedEnvelopeSchema = messageEnvelope(
  "job.accepted",
  JobAcceptedPayloadSchema,
);

export const JobCancelEnvelopeSchema = messageEnvelope(
  "job.cancel",
  JobCancelPayloadSchema,
);

export const JobEventEnvelopeSchema = messageEnvelope(
  "job.event",
  JobEventPayloadSchema,
);

export const JobResultEnvelopeSchema = messageEnvelope(
  "job.result",
  JobResultPayloadSchema,
);

export const JobErrorEnvelopeSchema = messageEnvelope(
  "job.error",
  JobErrorPayloadSchema,
);

// v1.1 §7.6 subscribe / subscribed / unsubscribe envelopes.

export const JobSubscribePayloadSchema = Schema.Struct({
  job_id: Schema.String.pipe(Schema.nonEmptyString()),
  from_event_seq: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ),
  history: Schema.optional(Schema.Boolean),
});
export type JobSubscribePayload = Schema.Schema.Type<
  typeof JobSubscribePayloadSchema
>;

export const JobSubscribedPayloadSchema = Schema.Struct({
  job_id: Schema.String.pipe(Schema.nonEmptyString()),
  current_status: JobStateSchema,
  agent: Schema.String.pipe(Schema.nonEmptyString()),
  lease: LeaseSchema,
  lease_constraints: Schema.optional(LeaseConstraintsSchema),
  budget: Schema.optional(JobBudgetSchema),
  parent_job_id: Schema.optional(Schema.NullOr(Schema.String)),
  trace_id: Schema.optional(Schema.String),
  subscribed_from: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  replayed: Schema.Boolean,
});
export type JobSubscribedPayload = Schema.Schema.Type<
  typeof JobSubscribedPayloadSchema
>;

export const JobUnsubscribePayloadSchema = Schema.Struct({
  job_id: Schema.String.pipe(Schema.nonEmptyString()),
});
export type JobUnsubscribePayload = Schema.Schema.Type<
  typeof JobUnsubscribePayloadSchema
>;

export const JobSubscribeEnvelopeSchema = messageEnvelope(
  "job.subscribe",
  JobSubscribePayloadSchema,
);

export const JobSubscribedEnvelopeSchema = messageEnvelope(
  "job.subscribed",
  JobSubscribedPayloadSchema,
);

export const JobUnsubscribeEnvelopeSchema = messageEnvelope(
  "job.unsubscribe",
  JobUnsubscribePayloadSchema,
);

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
