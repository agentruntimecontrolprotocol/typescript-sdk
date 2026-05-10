import { z } from "zod";
import { messageEnvelope } from "../envelope.js";

export const PermissionRequestPayloadSchema = z.object({
  permission: z.string().min(1),
  resource: z.string().min(1),
  operation: z.string().min(1),
  reason: z.string().optional(),
  requested_lease_seconds: z.number().int().positive().optional(),
});
export type PermissionRequestPayload = z.infer<typeof PermissionRequestPayloadSchema>;

export const PermissionGrantPayloadSchema = z.object({
  lease_id: z.string().min(1).optional(),
  permission: z.string().min(1),
  resource: z.string().min(1),
  operation: z.string().min(1),
  granted_by: z.string().optional(),
  expires_at: z.string().min(1).optional(),
});
export type PermissionGrantPayload = z.infer<typeof PermissionGrantPayloadSchema>;

export const PermissionDenyPayloadSchema = z.object({
  permission: z.string().min(1),
  resource: z.string().min(1),
  operation: z.string().min(1),
  reason: z.string().min(1),
});
export type PermissionDenyPayload = z.infer<typeof PermissionDenyPayloadSchema>;

// Lease lifecycle (§15.5) -----------------------------------------------

export const LeaseGrantedPayloadSchema = z.object({
  lease_id: z.string().min(1),
  permission: z.string().min(1),
  resource: z.string().min(1),
  operation: z.string().min(1),
  expires_at: z.string().min(1),
});
export type LeaseGrantedPayload = z.infer<typeof LeaseGrantedPayloadSchema>;

export const LeaseRefreshPayloadSchema = z.object({
  lease_id: z.string().min(1),
  requested_seconds: z.number().int().positive(),
});
export type LeaseRefreshPayload = z.infer<typeof LeaseRefreshPayloadSchema>;

export const LeaseExtendedPayloadSchema = z.object({
  lease_id: z.string().min(1),
  expires_at: z.string().min(1),
});
export type LeaseExtendedPayload = z.infer<typeof LeaseExtendedPayloadSchema>;

export const LeaseRevokedPayloadSchema = z.object({
  lease_id: z.string().min(1),
  reason: z.string().min(1),
});
export type LeaseRevokedPayload = z.infer<typeof LeaseRevokedPayloadSchema>;

// Envelopes -------------------------------------------------------------

export const PermissionRequestEnvelopeSchema = messageEnvelope(
  "permission.request",
  PermissionRequestPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const PermissionGrantEnvelopeSchema = messageEnvelope(
  "permission.grant",
  PermissionGrantPayloadSchema,
).extend({ session_id: z.string().min(1), correlation_id: z.string().min(1) });

export const PermissionDenyEnvelopeSchema = messageEnvelope(
  "permission.deny",
  PermissionDenyPayloadSchema,
).extend({ session_id: z.string().min(1), correlation_id: z.string().min(1) });

export const LeaseGrantedEnvelopeSchema = messageEnvelope(
  "lease.granted",
  LeaseGrantedPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const LeaseRefreshEnvelopeSchema = messageEnvelope(
  "lease.refresh",
  LeaseRefreshPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const LeaseExtendedEnvelopeSchema = messageEnvelope(
  "lease.extended",
  LeaseExtendedPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const LeaseRevokedEnvelopeSchema = messageEnvelope(
  "lease.revoked",
  LeaseRevokedPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const PERMISSION_ENVELOPES = [
  PermissionRequestEnvelopeSchema,
  PermissionGrantEnvelopeSchema,
  PermissionDenyEnvelopeSchema,
  LeaseGrantedEnvelopeSchema,
  LeaseRefreshEnvelopeSchema,
  LeaseExtendedEnvelopeSchema,
  LeaseRevokedEnvelopeSchema,
] as const;
