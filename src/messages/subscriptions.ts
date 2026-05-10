import { z } from "zod";
import { messageEnvelope, PrioritySchema } from "../envelope.js";

/** §13.2 filter shape. AND-ed across keys; arrays inside a key are OR-ed. */
export const SubscribeFilterSchema = z
  .object({
    session_id: z.array(z.string()).optional(),
    job_id: z.array(z.string()).optional(),
    stream_id: z.array(z.string()).optional(),
    trace_id: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
    min_priority: PrioritySchema.optional(),
  })
  .strict();
export type SubscribeFilter = z.infer<typeof SubscribeFilterSchema>;

export const SubscribePayloadSchema = z.object({
  filter: SubscribeFilterSchema,
  since: z
    .object({
      after_message_id: z.string().optional(),
      checkpoint_id: z.string().optional(),
    })
    .optional(),
});
export type SubscribePayload = z.infer<typeof SubscribePayloadSchema>;

export const SubscribeAcceptedPayloadSchema = z.object({
  subscription_id: z.string().min(1),
});
export type SubscribeAcceptedPayload = z.infer<typeof SubscribeAcceptedPayloadSchema>;

export const SubscribeEventPayloadSchema = z.object({
  /** The wrapped event. Validated against the discriminated union upstream. */
  event: z.unknown(),
});
export type SubscribeEventPayload = z.infer<typeof SubscribeEventPayloadSchema>;

export const UnsubscribePayloadSchema = z.object({
  subscription_id: z.string().min(1),
});
export type UnsubscribePayload = z.infer<typeof UnsubscribePayloadSchema>;

export const SubscribeClosedPayloadSchema = z.object({
  subscription_id: z.string().min(1),
  reason: z.string().min(1),
});
export type SubscribeClosedPayload = z.infer<typeof SubscribeClosedPayloadSchema>;

// Envelopes -------------------------------------------------------------

export const SubscribeEnvelopeSchema = messageEnvelope("subscribe", SubscribePayloadSchema).extend({
  session_id: z.string().min(1),
});

export const SubscribeAcceptedEnvelopeSchema = messageEnvelope(
  "subscribe.accepted",
  SubscribeAcceptedPayloadSchema,
).extend({
  session_id: z.string().min(1),
  correlation_id: z.string().min(1),
});

export const SubscribeEventEnvelopeSchema = messageEnvelope(
  "subscribe.event",
  SubscribeEventPayloadSchema,
).extend({
  session_id: z.string().min(1),
  subscription_id: z.string().min(1),
});

export const UnsubscribeEnvelopeSchema = messageEnvelope(
  "unsubscribe",
  UnsubscribePayloadSchema,
).extend({ session_id: z.string().min(1) });

export const SubscribeClosedEnvelopeSchema = messageEnvelope(
  "subscribe.closed",
  SubscribeClosedPayloadSchema,
).extend({
  session_id: z.string().min(1),
  subscription_id: z.string().min(1),
});

export const SUBSCRIPTION_ENVELOPES = [
  SubscribeEnvelopeSchema,
  SubscribeAcceptedEnvelopeSchema,
  SubscribeEventEnvelopeSchema,
  UnsubscribeEnvelopeSchema,
  SubscribeClosedEnvelopeSchema,
] as const;
