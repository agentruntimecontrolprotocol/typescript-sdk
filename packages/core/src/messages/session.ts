import { Schema } from "effect";

import { messageEnvelope } from "../envelope.js";
import { ErrorPayloadSchema } from "../errors.js";

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

/** §6.1 v1.0 supports bearer only. */
export const AuthSchemeSchema = Schema.Literal("bearer");
export type AuthScheme = Schema.Schema.Type<typeof AuthSchemeSchema>;

/** §6.1 credential block. Token is REQUIRED for the `bearer` scheme. */
export const AuthCredentialSchema = Schema.Struct({
  scheme: AuthSchemeSchema,
  token: Schema.optional(Schema.String),
});
export type AuthCredential = Schema.Schema.Type<typeof AuthCredentialSchema>;

/** §6.2 client identity block. */
export const ClientIdentitySchema = Schema.Struct({
  name: Schema.String.pipe(Schema.nonEmptyString()),
  version: Schema.String.pipe(Schema.nonEmptyString()),
  fingerprint: Schema.optional(Schema.String),
  principal: Schema.optional(Schema.String),
});
export type ClientIdentity = Schema.Schema.Type<typeof ClientIdentitySchema>;

/** §6.2 runtime identity block. */
export const RuntimeIdentitySchema = Schema.Struct({
  name: Schema.String.pipe(Schema.nonEmptyString()),
  version: Schema.String.pipe(Schema.nonEmptyString()),
  fingerprint: Schema.optional(Schema.String),
});
export type RuntimeIdentity = Schema.Schema.Type<typeof RuntimeIdentitySchema>;

/**
 * v1.1 §6.2 / §7.5 rich agent inventory entry. The `default` field declares
 * the version a bare-name `agent` resolves to.
 */
export const AgentInventoryEntrySchema = Schema.mutable(
  Schema.Struct({
    name: Schema.String.pipe(Schema.nonEmptyString()),
    versions: Schema.mutable(
      Schema.Array(Schema.String.pipe(Schema.nonEmptyString())),
    ),
    default: Schema.optional(Schema.String),
  }),
);
export type AgentInventoryEntry = Schema.Schema.Type<
  typeof AgentInventoryEntrySchema
>;

/**
 * Capability advertisement (§6.2).
 *
 * v1.0:
 *   - `encodings` — encoding formats the peer supports (e.g., "json").
 *   - `agents`    — agent identifiers the runtime can serve (runtime-side only).
 *
 * v1.1 extends this with:
 *   - `features`  — v1.1 feature flag list (intersected to form the effective
 *                   feature set; see §6.2 / `V1_1_FEATURES`).
 *   - `agents` MAY use a richer object shape advertising each agent's
 *                   available versions and default (§7.5).
 */
export const CapabilitiesSchema = Schema.mutable(
  Schema.Struct({
    encodings: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    agents: Schema.optional(
      Schema.Union(
        Schema.mutable(Schema.Array(Schema.String)),
        Schema.mutable(Schema.Array(AgentInventoryEntrySchema)),
      ),
    ),
    features: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  }),
);
export type Capabilities = Schema.Schema.Type<typeof CapabilitiesSchema>;

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
export type SessionResume = Schema.Schema.Type<typeof SessionResumeSchema>;

export const SessionHelloPayloadSchema = Schema.Struct({
  client: ClientIdentitySchema,
  auth: AuthCredentialSchema,
  capabilities: Schema.optional(CapabilitiesSchema),
  resume: Schema.optional(SessionResumeSchema),
});
export type SessionHelloPayload = Schema.Schema.Type<
  typeof SessionHelloPayloadSchema
>;

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
export type SessionWelcomePayload = Schema.Schema.Type<
  typeof SessionWelcomePayloadSchema
>;

export const SessionErrorPayloadSchema = ErrorPayloadSchema;
export type SessionErrorPayload = Schema.Schema.Type<
  typeof SessionErrorPayloadSchema
>;

export const SessionByePayloadSchema = Schema.Struct({
  reason: Schema.optional(Schema.String),
});
export type SessionByePayload = Schema.Schema.Type<
  typeof SessionByePayloadSchema
>;

export const SessionPingPayloadSchema = Schema.Struct({
  nonce: Schema.String.pipe(Schema.nonEmptyString()),
  sent_at: Schema.String.pipe(Schema.nonEmptyString()),
});
export type SessionPingPayload = Schema.Schema.Type<
  typeof SessionPingPayloadSchema
>;

export const SessionPongPayloadSchema = Schema.Struct({
  ping_nonce: Schema.String.pipe(Schema.nonEmptyString()),
  received_at: Schema.String.pipe(Schema.nonEmptyString()),
});
export type SessionPongPayload = Schema.Schema.Type<
  typeof SessionPongPayloadSchema
>;

export const SessionAckPayloadSchema = Schema.Struct({
  last_processed_seq: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export type SessionAckPayload = Schema.Schema.Type<
  typeof SessionAckPayloadSchema
>;

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
export type SessionListJobsFilter = Schema.Schema.Type<
  typeof SessionListJobsFilterSchema
>;

export const SessionListJobsPayloadSchema = Schema.Struct({
  filter: Schema.optional(SessionListJobsFilterSchema),
  limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  cursor: Schema.optional(Schema.NullOr(Schema.String)),
});
export type SessionListJobsPayload = Schema.Schema.Type<
  typeof SessionListJobsPayloadSchema
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
export type JobListEntry = Schema.Schema.Type<typeof JobListEntrySchema>;

export const SessionJobsPayloadSchema = Schema.Struct({
  request_id: Schema.String.pipe(Schema.nonEmptyString()),
  jobs: Schema.mutable(Schema.Array(JobListEntrySchema)),
  next_cursor: Schema.NullOr(Schema.String),
});
export type SessionJobsPayload = Schema.Schema.Type<
  typeof SessionJobsPayloadSchema
>;

// Envelopes — built with `messageEnvelope()` (Effect Schema).

export const SessionHelloEnvelopeSchema = messageEnvelope(
  "session.hello",
  SessionHelloPayloadSchema,
);
export const SessionWelcomeEnvelopeSchema = messageEnvelope(
  "session.welcome",
  SessionWelcomePayloadSchema,
);
export const SessionErrorEnvelopeSchema = messageEnvelope(
  "session.error",
  SessionErrorPayloadSchema,
);
export const SessionByeEnvelopeSchema = messageEnvelope(
  "session.bye",
  SessionByePayloadSchema,
);

export const SessionPingEnvelopeSchema = messageEnvelope(
  "session.ping",
  SessionPingPayloadSchema,
);
export const SessionPongEnvelopeSchema = messageEnvelope(
  "session.pong",
  SessionPongPayloadSchema,
);
export const SessionAckEnvelopeSchema = messageEnvelope(
  "session.ack",
  SessionAckPayloadSchema,
);
export const SessionListJobsEnvelopeSchema = messageEnvelope(
  "session.list_jobs",
  SessionListJobsPayloadSchema,
);
export const SessionJobsEnvelopeSchema = messageEnvelope(
  "session.jobs",
  SessionJobsPayloadSchema,
);

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
