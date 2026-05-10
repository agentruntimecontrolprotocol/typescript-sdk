import { z } from "zod";
import { messageEnvelope } from "../envelope.js";

/**
 * `response_schema` on a `human.input.request` is opaque JSON-Schema-like data.
 * The runtime validates responses against it via a small subset compiler; the
 * wire schema accepts any structured value.
 *
 * @see PLAN.md §4 open question 2.
 */
export const ResponseSchemaShape = z.record(z.string(), z.unknown());
export type ResponseSchema = z.infer<typeof ResponseSchemaShape>;

export const HumanInputRequestPayloadSchema = z.object({
  prompt: z.string().min(1),
  response_schema: ResponseSchemaShape,
  default: z.unknown().optional(),
  expires_at: z.string().min(1),
  destination: z.string().optional(),
});
export type HumanInputRequestPayload = z.infer<typeof HumanInputRequestPayloadSchema>;

export const HumanInputResponsePayloadSchema = z.object({
  value: z.unknown(),
  responded_by: z.string().min(1),
  responded_at: z.string(),
});
export type HumanInputResponsePayload = z.infer<typeof HumanInputResponsePayloadSchema>;

export const HumanInputCancelledPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().optional(),
});
export type HumanInputCancelledPayload = z.infer<typeof HumanInputCancelledPayloadSchema>;

export const HumanChoiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});
export type HumanChoiceOption = z.infer<typeof HumanChoiceOptionSchema>;

export const HumanChoiceRequestPayloadSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(HumanChoiceOptionSchema).min(1),
  expires_at: z.string().min(1),
  default: z.string().optional(),
});
export type HumanChoiceRequestPayload = z.infer<typeof HumanChoiceRequestPayloadSchema>;

export const HumanChoiceResponsePayloadSchema = z.object({
  choice_id: z.string().min(1),
  responded_by: z.string().min(1),
  responded_at: z.string(),
});
export type HumanChoiceResponsePayload = z.infer<typeof HumanChoiceResponsePayloadSchema>;

// Envelopes ------------------------------------------------------------

export const HumanInputRequestEnvelopeSchema = messageEnvelope(
  "human.input.request",
  HumanInputRequestPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const HumanInputResponseEnvelopeSchema = messageEnvelope(
  "human.input.response",
  HumanInputResponsePayloadSchema,
).extend({
  session_id: z.string().min(1),
  correlation_id: z.string().min(1),
});

export const HumanInputCancelledEnvelopeSchema = messageEnvelope(
  "human.input.cancelled",
  HumanInputCancelledPayloadSchema,
).extend({
  session_id: z.string().min(1),
  correlation_id: z.string().min(1),
});

export const HumanChoiceRequestEnvelopeSchema = messageEnvelope(
  "human.choice.request",
  HumanChoiceRequestPayloadSchema,
).extend({ session_id: z.string().min(1) });

export const HumanChoiceResponseEnvelopeSchema = messageEnvelope(
  "human.choice.response",
  HumanChoiceResponsePayloadSchema,
).extend({
  session_id: z.string().min(1),
  correlation_id: z.string().min(1),
});

export const HUMAN_ENVELOPES = [
  HumanInputRequestEnvelopeSchema,
  HumanInputResponseEnvelopeSchema,
  HumanInputCancelledEnvelopeSchema,
  HumanChoiceRequestEnvelopeSchema,
  HumanChoiceResponseEnvelopeSchema,
] as const;
