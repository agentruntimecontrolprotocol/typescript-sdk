import { Schema } from "effect";
import { z } from "zod";

import { messageEnvelope } from "../envelope.js";
import { ERROR_CODES, ErrorPayloadSchema } from "../errors.js";

// ARCP v1.0 + v1.1 session envelopes (§6):
//   session.hello     — client → runtime; opens a new or resumed session.
//   session.welcome   — runtime → client; issued on accepted hello.
//   session.error     — runtime → client; rejection or fatal session-level error.
//   session.bye       — either party; clean close.
//   session.ping      — either party; v1.1 heartbeat (§6.4).
//   session.pong      — either party; v1.1 heartbeat response (§6.4).
//   session.ack       — client → runtime; v1.1 flow-control ack (§6.5).
//   session.list_jobs — client → runtime; v1.1 job inventory request (§6.6).
//   session.jobs      — runtime → client; v1.1 job inventory response (§6.6).
//
// Effect-`Schema` payloads define the canonical wire shape. Zod twins
// (`*ZodSchema`) feed `messageEnvelope()` because the envelope layer is
// still zod-typed (slice #50). Where a payload type alias is consumed by
// in-process callers (e.g. `Capabilities`, `SessionJobsPayload`) we derive
// it from the zod twin to keep prior structural compatibility (the Effect
// inferred type has `ReadonlyArray<…>` and `readonly` modifiers which would
// be a non-trivial caller-side change to roll out in this slice).

/** §6.1 v1.0 supports bearer only. */
export const AuthSchemeSchema = Schema.Literal("bearer");
export const AuthSchemeZodSchema = z.enum(["bearer"]);
export type AuthScheme = z.infer<typeof AuthSchemeZodSchema>;

/** §6.1 credential block. Token is REQUIRED for the `bearer` scheme. */
export const AuthCredentialSchema = Schema.Struct({
  scheme: AuthSchemeSchema,
  token: Schema.optional(Schema.String),
});
export const AuthCredentialZodSchema = z.object({
  scheme: AuthSchemeZodSchema,
  token: z.string().optional(),
});
export type AuthCredential = z.infer<typeof AuthCredentialZodSchema>;

/** §6.2 client identity block. */
export const ClientIdentitySchema = Schema.Struct({
  name: Schema.String.pipe(Schema.nonEmptyString()),
  version: Schema.String.pipe(Schema.nonEmptyString()),
  fingerprint: Schema.optional(Schema.String),
  principal: Schema.optional(Schema.String),
});
export const ClientIdentityZodSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  fingerprint: z.string().optional(),
  principal: z.string().optional(),
});
export type ClientIdentity = z.infer<typeof ClientIdentityZodSchema>;

/** §6.2 runtime identity block. */
export const RuntimeIdentitySchema = Schema.Struct({
  name: Schema.String.pipe(Schema.nonEmptyString()),
  version: Schema.String.pipe(Schema.nonEmptyString()),
  fingerprint: Schema.optional(Schema.String),
});
export const RuntimeIdentityZodSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  fingerprint: z.string().optional(),
});
export type RuntimeIdentity = z.infer<typeof RuntimeIdentityZodSchema>;

/**
 * v1.1 §6.2 / §7.5 rich agent inventory entry. The `default` field declares
 * the version a bare-name `agent` resolves to.
 */
export const AgentInventoryEntrySchema = Schema.Struct({
  name: Schema.String.pipe(Schema.nonEmptyString()),
  versions: Schema.Array(Schema.String.pipe(Schema.nonEmptyString())),
  default: Schema.optional(Schema.String),
});
export const AgentInventoryEntryZodSchema = z.object({
  name: z.string().min(1),
  versions: z.array(z.string().min(1)),
  default: z.string().optional(),
});
export type AgentInventoryEntry = z.infer<typeof AgentInventoryEntryZodSchema>;

/**
 * Capability advertisement (§6.2).
 *
 * v1.0 capabilities is a small announcement:
 *   - `encodings` — encoding formats the peer supports (e.g., "json").
 *   - `agents`    — agent identifiers the runtime can serve (runtime-side only).
 *
 * v1.1 extends this with:
 *   - `features`  — v1.1 feature flag list (intersected to form the effective
 *                   feature set; see §6.2 / `V1_1_FEATURES`).
 *   - `agents` MAY use a richer object shape advertising each agent's
 *                   available versions and default (§7.5).
 *
 * Unknown peer fields round-trip via passthrough on the zod twin (the wire
 * surface that `messageEnvelope()` consumes). The Effect Schema mirrors the
 * declared field set; consumers that need passthrough should keep using the
 * zod twin.
 */
export const CapabilitiesSchema = Schema.Struct({
  encodings: Schema.optional(Schema.Array(Schema.String)),
  agents: Schema.optional(
    Schema.Union(
      Schema.Array(Schema.String),
      Schema.Array(AgentInventoryEntrySchema),
    ),
  ),
  features: Schema.optional(Schema.Array(Schema.String)),
});
export const CapabilitiesZodSchema = z
  .object({
    encodings: z.array(z.string()).optional(),
    agents: z
      .union([z.array(z.string()), z.array(AgentInventoryEntryZodSchema)])
      .optional(),
    features: z.array(z.string()).optional(),
  })
  .passthrough();
export type Capabilities = z.infer<typeof CapabilitiesZodSchema>;

/**
 * Normalize an `agents` advertisement to the rich v1.1 shape.
 *
 * - `undefined` → empty array.
 * - `string[]` → entries with empty `versions` and no `default`.
 * - `AgentInventoryEntry[]` → returned as-is.
 */
export function normalizeAgentInventory(
  agents: Capabilities["agents"] | undefined,
): AgentInventoryEntry[] {
  if (agents === undefined) return [];
  const arr = agents as readonly unknown[];
  if (arr.length === 0) return [];
  const first = arr[0];
  if (typeof first === "string") {
    return (arr as readonly string[]).map((name) => ({ name, versions: [] }));
  }
  return [...(arr as readonly AgentInventoryEntry[])];
}

/** §6.3 resume block embedded in session.hello to recover a prior session. */
export const SessionResumeSchema = Schema.Struct({
  session_id: Schema.String.pipe(Schema.nonEmptyString()),
  resume_token: Schema.String.pipe(Schema.nonEmptyString()),
  last_event_seq: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export const SessionResumeZodSchema = z.object({
  session_id: z.string().min(1).brand<"SessionId">(),
  resume_token: z.string().min(1).brand<"ResumeToken">(),
  last_event_seq: z.number().int().nonnegative().brand<"EventSeq">(),
});
export type SessionResume = z.infer<typeof SessionResumeZodSchema>;

export const SessionHelloPayloadSchema = Schema.Struct({
  client: ClientIdentitySchema,
  auth: AuthCredentialSchema,
  capabilities: Schema.optional(CapabilitiesSchema),
  resume: Schema.optional(SessionResumeSchema),
});
export const SessionHelloPayloadZodSchema = z.object({
  client: ClientIdentityZodSchema,
  auth: AuthCredentialZodSchema,
  capabilities: CapabilitiesZodSchema.optional(),
  resume: SessionResumeZodSchema.optional(),
});
export type SessionHelloPayload = z.infer<typeof SessionHelloPayloadZodSchema>;

/**
 * `session.welcome.payload` — v1.0 fields plus the OPTIONAL v1.1
 * `heartbeat_interval_sec` (§6.4). Absent means heartbeats are not
 * advertised; with the `heartbeat` feature negotiated, peers SHOULD use
 * either this value or a default (e.g., 30s).
 */
export const SessionWelcomePayloadSchema = Schema.Struct({
  runtime: RuntimeIdentitySchema,
  resume_token: Schema.String.pipe(Schema.nonEmptyString()),
  resume_window_sec: Schema.Number.pipe(Schema.int(), Schema.positive()),
  heartbeat_interval_sec: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.positive()),
  ),
  capabilities: CapabilitiesSchema,
});
export const SessionWelcomePayloadZodSchema = z.object({
  runtime: RuntimeIdentityZodSchema,
  resume_token: z.string().min(1).brand<"ResumeToken">(),
  resume_window_sec: z.number().int().positive(),
  heartbeat_interval_sec: z.number().int().positive().optional(),
  capabilities: CapabilitiesZodSchema,
});
export type SessionWelcomePayload = z.infer<
  typeof SessionWelcomePayloadZodSchema
>;

/** Internal Effect mirror of `ErrorPayloadSchema`; matches zod field-for-field. */
const ErrorPayloadEffectSchema = Schema.Struct({
  code: Schema.Literal(...ERROR_CODES),
  message: Schema.String.pipe(Schema.nonEmptyString()),
  retryable: Schema.optional(Schema.Boolean),
  details: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});

export const SessionErrorPayloadSchema = ErrorPayloadEffectSchema;
export const SessionErrorPayloadZodSchema = ErrorPayloadSchema;
export type SessionErrorPayload = z.infer<typeof SessionErrorPayloadZodSchema>;

export const SessionByePayloadSchema = Schema.Struct({
  reason: Schema.optional(Schema.String),
});
export const SessionByePayloadZodSchema = z.object({
  reason: z.string().optional(),
});
export type SessionByePayload = z.infer<typeof SessionByePayloadZodSchema>;

export const SessionPingPayloadSchema = Schema.Struct({
  nonce: Schema.String.pipe(Schema.nonEmptyString()),
  sent_at: Schema.String.pipe(Schema.nonEmptyString()),
});
export const SessionPingPayloadZodSchema = z.object({
  nonce: z.string().min(1),
  sent_at: z.string().min(1),
});
export type SessionPingPayload = z.infer<typeof SessionPingPayloadZodSchema>;

export const SessionPongPayloadSchema = Schema.Struct({
  ping_nonce: Schema.String.pipe(Schema.nonEmptyString()),
  received_at: Schema.String.pipe(Schema.nonEmptyString()),
});
export const SessionPongPayloadZodSchema = z.object({
  ping_nonce: z.string().min(1),
  received_at: z.string().min(1),
});
export type SessionPongPayload = z.infer<typeof SessionPongPayloadZodSchema>;

export const SessionAckPayloadSchema = Schema.Struct({
  last_processed_seq: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export const SessionAckPayloadZodSchema = z.object({
  last_processed_seq: z.number().int().nonnegative(),
});
export type SessionAckPayload = z.infer<typeof SessionAckPayloadZodSchema>;

/**
 * Note: `JOB_STATES` lives in `messages/execution.ts`; to avoid an import
 * cycle the filter accepts any non-empty string and execution-layer code
 * narrows when applied.
 */
export const SessionListJobsFilterSchema = Schema.Struct({
  status: Schema.optional(
    Schema.Array(Schema.String.pipe(Schema.nonEmptyString())),
  ),
  agent: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  created_after: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  created_before: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
});
export const SessionListJobsFilterZodSchema = z.object({
  status: z.array(z.string().min(1)).optional(),
  agent: z.string().min(1).optional(),
  created_after: z.string().min(1).optional(),
  created_before: z.string().min(1).optional(),
});
export type SessionListJobsFilter = z.infer<
  typeof SessionListJobsFilterZodSchema
>;

export const SessionListJobsPayloadSchema = Schema.Struct({
  filter: Schema.optional(SessionListJobsFilterSchema),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  cursor: Schema.optional(Schema.NullOr(Schema.String)),
});
export const SessionListJobsPayloadZodSchema = z.object({
  filter: SessionListJobsFilterZodSchema.optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().nullable().optional(),
});
export type SessionListJobsPayload = z.infer<
  typeof SessionListJobsPayloadZodSchema
>;

export const JobListEntrySchema = Schema.Struct({
  job_id: Schema.String.pipe(Schema.nonEmptyString()),
  agent: Schema.String.pipe(Schema.nonEmptyString()),
  status: Schema.String.pipe(Schema.nonEmptyString()),
  lease: Schema.Record({
    key: Schema.String,
    value: Schema.Array(Schema.String),
  }),
  parent_job_id: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String.pipe(Schema.nonEmptyString()),
  trace_id: Schema.optional(Schema.String),
  last_event_seq: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export const JobListEntryZodSchema = z.object({
  job_id: z.string().min(1).brand<"JobId">(),
  agent: z.string().min(1),
  status: z.string().min(1),
  lease: z.record(z.string(), z.array(z.string())),
  parent_job_id: z.string().brand<"JobId">().nullable().optional(),
  created_at: z.string().min(1),
  trace_id: z.string().brand<"TraceId">().optional(),
  last_event_seq: z.number().int().nonnegative().brand<"EventSeq">(),
});
export type JobListEntry = z.infer<typeof JobListEntryZodSchema>;

export const SessionJobsPayloadSchema = Schema.Struct({
  request_id: Schema.String.pipe(Schema.nonEmptyString()),
  jobs: Schema.Array(JobListEntrySchema),
  next_cursor: Schema.NullOr(Schema.String),
});
export const SessionJobsPayloadZodSchema = z.object({
  request_id: z.string().min(1),
  jobs: z.array(JobListEntryZodSchema),
  next_cursor: z.string().nullable(),
});
export type SessionJobsPayload = z.infer<typeof SessionJobsPayloadZodSchema>;

// Envelopes — built with `messageEnvelope()` (zod-typed; slice #50).

export const SessionHelloEnvelopeSchema = messageEnvelope(
  "session.hello",
  SessionHelloPayloadZodSchema,
);
export const SessionWelcomeEnvelopeSchema = messageEnvelope(
  "session.welcome",
  SessionWelcomePayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionErrorEnvelopeSchema = messageEnvelope(
  "session.error",
  SessionErrorPayloadZodSchema,
);
export const SessionByeEnvelopeSchema = messageEnvelope(
  "session.bye",
  SessionByePayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });

export const SessionPingEnvelopeSchema = messageEnvelope(
  "session.ping",
  SessionPingPayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionPongEnvelopeSchema = messageEnvelope(
  "session.pong",
  SessionPongPayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionAckEnvelopeSchema = messageEnvelope(
  "session.ack",
  SessionAckPayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionListJobsEnvelopeSchema = messageEnvelope(
  "session.list_jobs",
  SessionListJobsPayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionJobsEnvelopeSchema = messageEnvelope(
  "session.jobs",
  SessionJobsPayloadZodSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });

export const SESSION_ENVELOPES = [
  SessionHelloEnvelopeSchema,
  SessionWelcomeEnvelopeSchema,
  SessionErrorEnvelopeSchema,
  SessionByeEnvelopeSchema,
  SessionPingEnvelopeSchema,
  SessionPongEnvelopeSchema,
  SessionAckEnvelopeSchema,
  SessionListJobsEnvelopeSchema,
  SessionJobsEnvelopeSchema,
] as const;
