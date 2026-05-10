import { z } from "zod";
import { messageEnvelope } from "../envelope.js";
import { ErrorPayloadSchema } from "../errors.js";

// Liveness ---------------------------------------------------------------

export const PingPayloadSchema = z.object({});
export type PingPayload = z.infer<typeof PingPayloadSchema>;

export const PongPayloadSchema = z.object({
  ack_for: z.string().min(1),
  received_at: z.string(),
});
export type PongPayload = z.infer<typeof PongPayloadSchema>;

// Acks -------------------------------------------------------------------

export const AckPayloadSchema = z.object({
  ack_for: z.string().min(1),
  received_at: z.string(),
});
export type AckPayload = z.infer<typeof AckPayloadSchema>;

export const NackPayloadSchema = ErrorPayloadSchema.extend({
  ack_for: z.string().optional(),
});
export type NackPayload = z.infer<typeof NackPayloadSchema>;

// Cancellation -----------------------------------------------------------

export const CancelTargetSchema = z.enum(["job", "stream", "session"]);
export type CancelTarget = z.infer<typeof CancelTargetSchema>;

export const CancelPayloadSchema = z.object({
  target: CancelTargetSchema,
  target_id: z.string().min(1),
  reason: z.string().optional(),
  deadline_ms: z.number().int().positive().optional(),
});
export type CancelPayload = z.infer<typeof CancelPayloadSchema>;

export const CancelAcceptedPayloadSchema = z.object({
  target: CancelTargetSchema,
  target_id: z.string().min(1),
});
export type CancelAcceptedPayload = z.infer<typeof CancelAcceptedPayloadSchema>;

export const CancelRefusedPayloadSchema = z.object({
  target: CancelTargetSchema,
  target_id: z.string().min(1),
  reason: z.enum(["not_cancellable", "already_terminal", "not_found"]),
});
export type CancelRefusedPayload = z.infer<typeof CancelRefusedPayloadSchema>;

// Interrupt --------------------------------------------------------------

export const InterruptPayloadSchema = z.object({
  target: CancelTargetSchema,
  target_id: z.string().min(1),
  prompt: z.string().optional(),
});
export type InterruptPayload = z.infer<typeof InterruptPayloadSchema>;

// Resume -----------------------------------------------------------------

export const ResumePayloadSchema = z.object({
  after_message_id: z.string().optional(),
  checkpoint_id: z.string().optional(),
  include_open_streams: z.boolean().optional(),
});
export type ResumePayload = z.infer<typeof ResumePayloadSchema>;

// Backpressure -----------------------------------------------------------

export const BackpressurePayloadSchema = z.object({
  desired_rate_per_second: z.number().nonnegative().optional(),
  buffer_remaining_bytes: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
});
export type BackpressurePayload = z.infer<typeof BackpressurePayloadSchema>;

// Checkpoint (stub) ------------------------------------------------------

export const CheckpointCreatePayloadSchema = z.object({
  checkpoint_id: z.string().optional(),
  snapshot: z.unknown().optional(),
});
export const CheckpointRestorePayloadSchema = z.object({
  checkpoint_id: z.string().min(1),
});

// Envelopes --------------------------------------------------------------

export const PingEnvelopeSchema = messageEnvelope("ping", PingPayloadSchema);
export const PongEnvelopeSchema = messageEnvelope("pong", PongPayloadSchema).extend({
  correlation_id: z.string().min(1),
});
export const AckEnvelopeSchema = messageEnvelope("ack", AckPayloadSchema).extend({
  correlation_id: z.string().min(1),
});
export const NackEnvelopeSchema = messageEnvelope("nack", NackPayloadSchema);
export const CancelEnvelopeSchema = messageEnvelope("cancel", CancelPayloadSchema);
export const CancelAcceptedEnvelopeSchema = messageEnvelope(
  "cancel.accepted",
  CancelAcceptedPayloadSchema,
).extend({ correlation_id: z.string().min(1) });
export const CancelRefusedEnvelopeSchema = messageEnvelope(
  "cancel.refused",
  CancelRefusedPayloadSchema,
).extend({ correlation_id: z.string().min(1) });
export const InterruptEnvelopeSchema = messageEnvelope("interrupt", InterruptPayloadSchema);
export const ResumeEnvelopeSchema = messageEnvelope("resume", ResumePayloadSchema).extend({
  session_id: z.string().min(1),
});
export const BackpressureEnvelopeSchema = messageEnvelope(
  "backpressure",
  BackpressurePayloadSchema,
);
export const CheckpointCreateEnvelopeSchema = messageEnvelope(
  "checkpoint.create",
  CheckpointCreatePayloadSchema,
);
export const CheckpointRestoreEnvelopeSchema = messageEnvelope(
  "checkpoint.restore",
  CheckpointRestorePayloadSchema,
);

export const CONTROL_ENVELOPES = [
  PingEnvelopeSchema,
  PongEnvelopeSchema,
  AckEnvelopeSchema,
  NackEnvelopeSchema,
  CancelEnvelopeSchema,
  CancelAcceptedEnvelopeSchema,
  CancelRefusedEnvelopeSchema,
  InterruptEnvelopeSchema,
  ResumeEnvelopeSchema,
  BackpressureEnvelopeSchema,
  CheckpointCreateEnvelopeSchema,
  CheckpointRestoreEnvelopeSchema,
] as const;
