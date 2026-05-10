import { z } from "zod";
import { messageEnvelope } from "../envelope.js";

/** §16.1 canonical artifact reference shape. */
export const ArtifactRefSchema = z.object({
  artifact_id: z.string().min(1),
  uri: z.string().min(1),
  media_type: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().optional(),
  expires_at: z.string().optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const ArtifactPutPayloadSchema = z.object({
  artifact_id: z.string().min(1).optional(),
  media_type: z.string().min(1),
  data: z.string().optional(),
  encoding: z.enum(["base64"]).optional(),
  ttl_seconds: z.number().int().positive().optional(),
});
export type ArtifactPutPayload = z.infer<typeof ArtifactPutPayloadSchema>;

export const ArtifactFetchPayloadSchema = z.object({
  artifact_id: z.string().min(1),
});
export type ArtifactFetchPayload = z.infer<typeof ArtifactFetchPayloadSchema>;

export const ArtifactReleasePayloadSchema = z.object({
  artifact_id: z.string().min(1),
});
export type ArtifactReleasePayload = z.infer<typeof ArtifactReleasePayloadSchema>;

// Envelopes -------------------------------------------------------------

export const ArtifactPutEnvelopeSchema = messageEnvelope(
  "artifact.put",
  ArtifactPutPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const ArtifactFetchEnvelopeSchema = messageEnvelope(
  "artifact.fetch",
  ArtifactFetchPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const ArtifactRefEnvelopeSchema = messageEnvelope("artifact.ref", ArtifactRefSchema).extend({
  session_id: z.string().min(1),
  correlation_id: z.string().min(1),
});

export const ArtifactReleaseEnvelopeSchema = messageEnvelope(
  "artifact.release",
  ArtifactReleasePayloadSchema,
).extend({ session_id: z.string().min(1) });

export const ARTIFACT_ENVELOPES = [
  ArtifactPutEnvelopeSchema,
  ArtifactFetchEnvelopeSchema,
  ArtifactRefEnvelopeSchema,
  ArtifactReleaseEnvelopeSchema,
] as const;
