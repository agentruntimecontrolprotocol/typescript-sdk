import { z } from "zod";

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
export const AuthSchemeSchema = z.enum(["bearer"]);
export type AuthScheme = z.infer<typeof AuthSchemeSchema>;

/** §6.1 credential block. Token is REQUIRED for the `bearer` scheme. */
export const AuthCredentialSchema = z.object({
  scheme: AuthSchemeSchema,
  token: z.string().optional(),
});
export type AuthCredential = z.infer<typeof AuthCredentialSchema>;

/** §6.2 client identity block. */
export const ClientIdentitySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  fingerprint: z.string().optional(),
  principal: z.string().optional(),
});
export type ClientIdentity = z.infer<typeof ClientIdentitySchema>;

/** §6.2 runtime identity block. */
export const RuntimeIdentitySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  fingerprint: z.string().optional(),
});
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

/**
 * v1.1 §6.2 / §7.5 rich agent inventory entry. The `default` field declares
 * the version a bare-name `agent` resolves to.
 */
export const AgentInventoryEntrySchema = z.object({
  name: z.string().min(1),
  versions: z.array(z.string().min(1)),
  default: z.string().optional(),
});
export type AgentInventoryEntry = z.infer<typeof AgentInventoryEntrySchema>;

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
 * Unknown peer fields round-trip via `.passthrough()`. Custom values SHOULD
 * use the `x-vendor.*` prefix per §15.
 */
export const CapabilitiesSchema = z
  .object({
    encodings: z.array(z.string()).optional(),
    agents: z
      .union([z.array(z.string()), z.array(AgentInventoryEntrySchema)])
      .optional(),
    features: z.array(z.string()).optional(),
  })
  .passthrough();
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

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
export const SessionResumeSchema = z.object({
  session_id: z.string().min(1).brand<"SessionId">(),
  resume_token: z.string().min(1).brand<"ResumeToken">(),
  last_event_seq: z.number().int().nonnegative().brand<"EventSeq">(),
});
export type SessionResume = z.infer<typeof SessionResumeSchema>;

export const SessionHelloPayloadSchema = z.object({
  client: ClientIdentitySchema,
  auth: AuthCredentialSchema,
  capabilities: CapabilitiesSchema.optional(),
  resume: SessionResumeSchema.optional(),
});
export type SessionHelloPayload = z.infer<typeof SessionHelloPayloadSchema>;

/**
 * `session.welcome.payload` — v1.0 fields plus the OPTIONAL v1.1
 * `heartbeat_interval_sec` (§6.4). Absent means heartbeats are not
 * advertised; with the `heartbeat` feature negotiated, peers SHOULD use
 * either this value or a default (e.g., 30s).
 */
export const SessionWelcomePayloadSchema = z.object({
  runtime: RuntimeIdentitySchema,
  resume_token: z.string().min(1).brand<"ResumeToken">(),
  resume_window_sec: z.number().int().positive(),
  heartbeat_interval_sec: z.number().int().positive().optional(),
  capabilities: CapabilitiesSchema,
});
export type SessionWelcomePayload = z.infer<typeof SessionWelcomePayloadSchema>;

export const SessionErrorPayloadSchema = ErrorPayloadSchema;
export type SessionErrorPayload = z.infer<typeof SessionErrorPayloadSchema>;

export const SessionByePayloadSchema = z.object({
  reason: z.string().optional(),
});
export type SessionByePayload = z.infer<typeof SessionByePayloadSchema>;

export const SessionPingPayloadSchema = z.object({
  nonce: z.string().min(1),
  sent_at: z.string().min(1),
});
export type SessionPingPayload = z.infer<typeof SessionPingPayloadSchema>;

export const SessionPongPayloadSchema = z.object({
  ping_nonce: z.string().min(1),
  received_at: z.string().min(1),
});
export type SessionPongPayload = z.infer<typeof SessionPongPayloadSchema>;

export const SessionAckPayloadSchema = z.object({
  last_processed_seq: z.number().int().nonnegative(),
});
export type SessionAckPayload = z.infer<typeof SessionAckPayloadSchema>;

/**
 * Note: `JOB_STATES` lives in `messages/execution.ts`; to avoid an import
 * cycle the filter accepts any non-empty string and execution-layer code
 * narrows when applied.
 */
export const SessionListJobsFilterSchema = z.object({
  status: z.array(z.string().min(1)).optional(),
  agent: z.string().min(1).optional(),
  created_after: z.string().min(1).optional(),
  created_before: z.string().min(1).optional(),
});
export type SessionListJobsFilter = z.infer<typeof SessionListJobsFilterSchema>;

export const SessionListJobsPayloadSchema = z.object({
  filter: SessionListJobsFilterSchema.optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().nullable().optional(),
});
export type SessionListJobsPayload = z.infer<
  typeof SessionListJobsPayloadSchema
>;

export const JobListEntrySchema = z.object({
  job_id: z.string().min(1).brand<"JobId">(),
  agent: z.string().min(1),
  status: z.string().min(1),
  lease: z.record(z.string(), z.array(z.string())),
  parent_job_id: z.string().brand<"JobId">().nullable().optional(),
  created_at: z.string().min(1),
  trace_id: z.string().brand<"TraceId">().optional(),
  last_event_seq: z.number().int().nonnegative().brand<"EventSeq">(),
});
export type JobListEntry = z.infer<typeof JobListEntrySchema>;

export const SessionJobsPayloadSchema = z.object({
  request_id: z.string().min(1),
  jobs: z.array(JobListEntrySchema),
  next_cursor: z.string().nullable(),
});
export type SessionJobsPayload = z.infer<typeof SessionJobsPayloadSchema>;

export const SessionHelloEnvelopeSchema = messageEnvelope(
  "session.hello",
  SessionHelloPayloadSchema,
);
export const SessionWelcomeEnvelopeSchema = messageEnvelope(
  "session.welcome",
  SessionWelcomePayloadSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionErrorEnvelopeSchema = messageEnvelope(
  "session.error",
  SessionErrorPayloadSchema,
);
export const SessionByeEnvelopeSchema = messageEnvelope(
  "session.bye",
  SessionByePayloadSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });

export const SessionPingEnvelopeSchema = messageEnvelope(
  "session.ping",
  SessionPingPayloadSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionPongEnvelopeSchema = messageEnvelope(
  "session.pong",
  SessionPongPayloadSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionAckEnvelopeSchema = messageEnvelope(
  "session.ack",
  SessionAckPayloadSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionListJobsEnvelopeSchema = messageEnvelope(
  "session.list_jobs",
  SessionListJobsPayloadSchema,
).extend({ session_id: z.string().min(1).brand<"SessionId">() });
export const SessionJobsEnvelopeSchema = messageEnvelope(
  "session.jobs",
  SessionJobsPayloadSchema,
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
