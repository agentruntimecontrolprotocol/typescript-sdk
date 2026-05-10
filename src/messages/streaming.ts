import { z } from "zod";
import { messageEnvelope } from "../envelope.js";
import { ErrorPayloadSchema } from "../errors.js";

/** §11.1 stream kinds. Implementations SHOULD treat unknown kinds as `event`. */
export const STREAM_KINDS = ["text", "binary", "event", "log", "metric", "thought"] as const;
export const StreamKindSchema = z.enum(STREAM_KINDS);
export type StreamKind = z.infer<typeof StreamKindSchema>;

export const StreamOpenPayloadSchema = z.object({
  kind: StreamKindSchema,
  content_type: z.string().optional(),
  encoding: z.string().optional(),
  related_job_id: z.string().optional(),
});
export type StreamOpenPayload = z.infer<typeof StreamOpenPayloadSchema>;

/**
 * Generic stream chunk shape. Different `kind`s use different fields:
 *  - `text`/`binary`: `data` (string for text, base64 string for binary).
 *  - `event`: `event` (structured object).
 *  - `log`: `log` (an entry compatible with the `log` envelope payload).
 *  - `metric`: `metric` (an entry compatible with the `metric` envelope payload).
 *  - `thought`: `role`, `content`, `redacted` per §11.4.
 *
 * We accept any shape with `sequence`; runtime handlers narrow per-kind.
 */
export const StreamChunkPayloadSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    data: z.string().optional(),
    event: z.record(z.string(), z.unknown()).optional(),
    log: z.unknown().optional(),
    metric: z.unknown().optional(),
    role: z.string().optional(),
    content: z.string().optional(),
    redacted: z.boolean().optional(),
    content_type: z.string().optional(),
    sha256: z.string().optional(),
  })
  .passthrough();
export type StreamChunkPayload = z.infer<typeof StreamChunkPayloadSchema>;

export const StreamClosePayloadSchema = z.object({
  reason: z.string().optional(),
  total_chunks: z.number().int().nonnegative().optional(),
});
export type StreamClosePayload = z.infer<typeof StreamClosePayloadSchema>;

export const StreamErrorPayloadSchema = ErrorPayloadSchema;
export type StreamErrorPayload = z.infer<typeof StreamErrorPayloadSchema>;

// Envelopes ------------------------------------------------------------

export const StreamOpenEnvelopeSchema = messageEnvelope(
  "stream.open",
  StreamOpenPayloadSchema,
).extend({
  session_id: z.string().min(1),
  stream_id: z.string().min(1),
});
export const StreamChunkEnvelopeSchema = messageEnvelope(
  "stream.chunk",
  StreamChunkPayloadSchema,
).extend({
  session_id: z.string().min(1),
  stream_id: z.string().min(1),
});
export const StreamCloseEnvelopeSchema = messageEnvelope(
  "stream.close",
  StreamClosePayloadSchema,
).extend({
  session_id: z.string().min(1),
  stream_id: z.string().min(1),
});
export const StreamErrorEnvelopeSchema = messageEnvelope(
  "stream.error",
  StreamErrorPayloadSchema,
).extend({
  session_id: z.string().min(1),
  stream_id: z.string().min(1),
});

export const STREAMING_ENVELOPES = [
  StreamOpenEnvelopeSchema,
  StreamChunkEnvelopeSchema,
  StreamCloseEnvelopeSchema,
  StreamErrorEnvelopeSchema,
] as const;
