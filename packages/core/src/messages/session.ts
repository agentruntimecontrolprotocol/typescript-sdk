import { z } from "zod";
import { messageEnvelope } from "../envelope.js";
import { ErrorPayloadSchema } from "../errors.js";

// ARCP v1.0 session envelopes (§6):
//   session.hello   — client → runtime; opens a new or resumed session.
//   session.welcome — runtime → client; issued on accepted hello.
//   session.error   — runtime → client; rejection or fatal session-level error.
//   session.bye     — either party; clean close.

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
 * Capability advertisement (§6.2).
 *
 * v1.0 capabilities is a small announcement (NOT a feature-flag negotiation):
 *   - `encodings` — encoding formats the peer supports (e.g., "json").
 *   - `agents`    — agent identifiers the runtime can serve (runtime-side only).
 *
 * Unknown peer fields round-trip via `.passthrough()`. Custom values SHOULD
 * use the `x-vendor.*` prefix per §15.
 */
export const CapabilitiesSchema = z
  .object({
    encodings: z.array(z.string()).optional(),
    agents: z.array(z.string()).optional(),
  })
  .passthrough();
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

// ---- session.hello ----------------------------------------------------------

/** §6.3 resume block embedded in session.hello to recover a prior session. */
export const SessionResumeSchema = z.object({
  session_id: z.string().min(1),
  resume_token: z.string().min(1),
  last_event_seq: z.number().int().nonnegative(),
});
export type SessionResume = z.infer<typeof SessionResumeSchema>;

export const SessionHelloPayloadSchema = z.object({
  client: ClientIdentitySchema,
  auth: AuthCredentialSchema,
  capabilities: CapabilitiesSchema.optional(),
  resume: SessionResumeSchema.optional(),
});
export type SessionHelloPayload = z.infer<typeof SessionHelloPayloadSchema>;

// ---- session.welcome --------------------------------------------------------

export const SessionWelcomePayloadSchema = z.object({
  runtime: RuntimeIdentitySchema,
  resume_token: z.string().min(1),
  resume_window_sec: z.number().int().positive(),
  capabilities: CapabilitiesSchema,
});
export type SessionWelcomePayload = z.infer<typeof SessionWelcomePayloadSchema>;

// ---- session.error ----------------------------------------------------------

export const SessionErrorPayloadSchema = ErrorPayloadSchema;
export type SessionErrorPayload = z.infer<typeof SessionErrorPayloadSchema>;

// ---- session.bye ------------------------------------------------------------

export const SessionByePayloadSchema = z.object({
  reason: z.string().optional(),
});
export type SessionByePayload = z.infer<typeof SessionByePayloadSchema>;

// ---- Envelopes --------------------------------------------------------------

export const SessionHelloEnvelopeSchema = messageEnvelope(
  "session.hello",
  SessionHelloPayloadSchema,
);
export const SessionWelcomeEnvelopeSchema = messageEnvelope(
  "session.welcome",
  SessionWelcomePayloadSchema,
).extend({ session_id: z.string().min(1) });
export const SessionErrorEnvelopeSchema = messageEnvelope(
  "session.error",
  SessionErrorPayloadSchema,
);
export const SessionByeEnvelopeSchema = messageEnvelope(
  "session.bye",
  SessionByePayloadSchema,
).extend({ session_id: z.string().min(1) });

export const SESSION_ENVELOPES = [
  SessionHelloEnvelopeSchema,
  SessionWelcomeEnvelopeSchema,
  SessionErrorEnvelopeSchema,
  SessionByeEnvelopeSchema,
] as const;
