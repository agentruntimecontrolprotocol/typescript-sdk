import { z } from "zod";
import { messageEnvelope } from "../envelope.js";
import { ErrorPayloadSchema } from "../errors.js";

/**
 * Authentication scheme advertised by the client (§8.2).
 *
 * v0.1 supports `bearer`, `signed_jwt`, and `none` only. `mtls` and `oauth2`
 * are reserved in the wire schema (so we round-trip messages from peers that
 * advertise them) but the runtime rejects them with `UNIMPLEMENTED`.
 */
export const AuthSchemeSchema = z.enum(["bearer", "mtls", "oauth2", "signed_jwt", "none"]);
export type AuthScheme = z.infer<typeof AuthSchemeSchema>;

/** §8.2 credential block. */
export const AuthCredentialSchema = z.object({
  scheme: AuthSchemeSchema,
  token: z.string().optional(),
});
export type AuthCredential = z.infer<typeof AuthCredentialSchema>;

/** §8.2 client identity block. */
export const ClientIdentitySchema = z.object({
  kind: z.string().min(1),
  version: z.string().min(1),
  fingerprint: z.string().optional(),
  principal: z.string().optional(),
});
export type ClientIdentity = z.infer<typeof ClientIdentitySchema>;

/** §8.3 runtime identity block. */
export const RuntimeIdentitySchema = z.object({
  kind: z.string().min(1),
  version: z.string().min(1),
  fingerprint: z.string().optional(),
  trust_level: z.enum(["untrusted", "constrained", "trusted", "privileged"]).optional(),
});
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

/**
 * Capability advertisement (§7).
 *
 * Booleans are open-ended; absence is `false` per §7. We typecheck a known
 * set; unknown booleans are accepted and forwarded but ignored.
 */
export const CapabilitiesSchema = z
  .object({
    streaming: z.boolean().optional(),
    durable_jobs: z.boolean().optional(),
    checkpoints: z.boolean().optional(),
    binary_streams: z.boolean().optional(),
    binary_encoding: z.array(z.enum(["base64", "sidecar"])).optional(),
    agent_handoff: z.boolean().optional(),
    human_input: z.boolean().optional(),
    artifacts: z.boolean().optional(),
    subscriptions: z.boolean().optional(),
    scheduled_jobs: z.boolean().optional(),
    interrupt: z.boolean().optional(),
    anonymous: z.boolean().optional(),
    heartbeat_interval_seconds: z.number().int().positive().optional(),
    heartbeat_recovery: z.enum(["fail", "block"]).optional(),
    artifact_retention: z
      .object({
        default_seconds: z.number().int().nonnegative(),
        max_seconds: z.number().int().nonnegative(),
      })
      .optional(),
    extensions: z.array(z.string()).optional(),
  })
  .passthrough();
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

// ---- Per-message payload schemas --------------------------------------------

export const SessionOpenPayloadSchema = z.object({
  auth: AuthCredentialSchema,
  client: ClientIdentitySchema,
  capabilities: CapabilitiesSchema,
});
export type SessionOpenPayload = z.infer<typeof SessionOpenPayloadSchema>;

export const SessionChallengePayloadSchema = z.object({
  challenge_id: z.string().min(1),
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type SessionChallengePayload = z.infer<typeof SessionChallengePayloadSchema>;

export const SessionAuthenticatePayloadSchema = z.object({
  challenge_id: z.string().min(1),
  response: z.unknown(),
});
export type SessionAuthenticatePayload = z.infer<typeof SessionAuthenticatePayloadSchema>;

export const SessionAcceptedPayloadSchema = z.object({
  session_id: z.string().min(1),
  runtime: RuntimeIdentitySchema,
  capabilities: CapabilitiesSchema,
  lease: z
    .object({
      expires_at: z.string(),
    })
    .optional(),
});
export type SessionAcceptedPayload = z.infer<typeof SessionAcceptedPayloadSchema>;

export const SessionUnauthenticatedPayloadSchema = z.object({
  reason: z.string().min(1),
});
export type SessionUnauthenticatedPayload = z.infer<typeof SessionUnauthenticatedPayloadSchema>;

export const SessionRejectedPayloadSchema = ErrorPayloadSchema;
export type SessionRejectedPayload = z.infer<typeof SessionRejectedPayloadSchema>;

export const SessionRefreshPayloadSchema = z.object({
  reason: z.string().min(1),
  deadline_ms: z.number().int().positive(),
});
export type SessionRefreshPayload = z.infer<typeof SessionRefreshPayloadSchema>;

export const EVICTION_REASONS = [
  "DEADLINE_EXCEEDED",
  "RESOURCE_EXHAUSTED",
  "UNAUTHENTICATED",
  "ABORTED",
  "FAILED_PRECONDITION",
  "CANCELLED",
] as const;
export const SessionEvictedPayloadSchema = z.object({
  reason: z.enum(EVICTION_REASONS),
  message: z.string().optional(),
  allow_resume: z.boolean().optional(),
});
export type SessionEvictedPayload = z.infer<typeof SessionEvictedPayloadSchema>;

export const SessionClosePayloadSchema = z.object({
  reason: z.string().optional(),
  dispose_jobs: z.enum(["cancel", "detach"]).optional(),
});
export type SessionClosePayload = z.infer<typeof SessionClosePayloadSchema>;

// ---- Envelopes --------------------------------------------------------------

export const SessionOpenEnvelopeSchema = messageEnvelope("session.open", SessionOpenPayloadSchema);
export const SessionChallengeEnvelopeSchema = messageEnvelope(
  "session.challenge",
  SessionChallengePayloadSchema,
).extend({ correlation_id: z.string().min(1) });
export const SessionAuthenticateEnvelopeSchema = messageEnvelope(
  "session.authenticate",
  SessionAuthenticatePayloadSchema,
).extend({ correlation_id: z.string().min(1) });
export const SessionAcceptedEnvelopeSchema = messageEnvelope(
  "session.accepted",
  SessionAcceptedPayloadSchema,
).extend({ correlation_id: z.string().min(1) });
export const SessionUnauthenticatedEnvelopeSchema = messageEnvelope(
  "session.unauthenticated",
  SessionUnauthenticatedPayloadSchema,
);
export const SessionRejectedEnvelopeSchema = messageEnvelope(
  "session.rejected",
  SessionRejectedPayloadSchema,
).extend({ correlation_id: z.string().min(1) });
export const SessionRefreshEnvelopeSchema = messageEnvelope(
  "session.refresh",
  SessionRefreshPayloadSchema,
).extend({ session_id: z.string().min(1) });
export const SessionEvictedEnvelopeSchema = messageEnvelope(
  "session.evicted",
  SessionEvictedPayloadSchema,
).extend({ session_id: z.string().min(1) });
export const SessionCloseEnvelopeSchema = messageEnvelope(
  "session.close",
  SessionClosePayloadSchema,
).extend({ session_id: z.string().min(1) });

export const SESSION_ENVELOPES = [
  SessionOpenEnvelopeSchema,
  SessionChallengeEnvelopeSchema,
  SessionAuthenticateEnvelopeSchema,
  SessionAcceptedEnvelopeSchema,
  SessionUnauthenticatedEnvelopeSchema,
  SessionRejectedEnvelopeSchema,
  SessionRefreshEnvelopeSchema,
  SessionEvictedEnvelopeSchema,
  SessionCloseEnvelopeSchema,
] as const;
