import { z } from "zod";
import { validateExtensionsObject } from "./extensions.js";
import { PROTOCOL_VERSION } from "./version.js";

/**
 * Priority levels for envelope routing (§6.5).
 */
export const PrioritySchema = z.enum(["low", "normal", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

/**
 * RFC 3339 / ISO 8601 timestamp validator. Accepts any string parseable by
 * `Date.parse`. We do not check for sub-millisecond precision; the field is
 * informational (§6.1.1, §6.4 — ordering is by `id`, not timestamp).
 */
const Iso8601 = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "must be an RFC 3339 / ISO 8601 timestamp",
});

/**
 * Schema for the `extensions` field on an envelope (§21).
 *
 * Carries:
 *  - `optional` — boolean flag for §21.3 dispatch ("drop silently if not advertised").
 *  - any additional keys must be valid extension namespaces (§21.1); validation is
 *    deferred to {@link validateExtensionsObject} via a refinement.
 */
export const EnvelopeExtensionsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((obj, ctx) => {
    try {
      validateExtensionsObject(obj);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

/**
 * Base envelope shape per §6.1.1.
 *
 * `payload` is `unknown`; per-message-type schemas in `messages/` narrow it
 * to a specific shape via `z.discriminatedUnion("type", [...])` and direct
 * extension of this base.
 */
export const BaseEnvelopeSchema = z.object({
  arcp: z.string().min(1),
  id: z.string().min(1),
  type: z.string().min(1),
  timestamp: Iso8601,
  source: z.string().optional(),
  target: z.string().optional(),
  session_id: z.string().optional(),
  job_id: z.string().optional(),
  stream_id: z.string().optional(),
  subscription_id: z.string().optional(),
  trace_id: z.string().optional(),
  span_id: z.string().optional(),
  parent_span_id: z.string().optional(),
  correlation_id: z.string().optional(),
  causation_id: z.string().optional(),
  idempotency_key: z.string().optional(),
  priority: PrioritySchema.optional(),
  extensions: EnvelopeExtensionsSchema.optional(),
  payload: z.unknown(),
});

/**
 * The base envelope, type-only. Specific message envelopes refine this base
 * by overriding `type` to a literal and `payload` to a typed schema.
 */
export type BaseEnvelope = z.infer<typeof BaseEnvelopeSchema>;

/**
 * Optional fields on the base envelope, used to construct envelopes by
 * spreading only the fields that are defined.
 *
 * Each field uses `| undefined` so callers can pass `{ session_id: x }`
 * where `x` may be undefined (zod's `.optional()` output type) and rely on
 * {@link pickDefined} or {@link buildEnvelope} to strip undefined keys.
 */
export type EnvelopeOptionalFields = {
  source?: string | undefined;
  target?: string | undefined;
  session_id?: string | undefined;
  job_id?: string | undefined;
  stream_id?: string | undefined;
  subscription_id?: string | undefined;
  trace_id?: string | undefined;
  span_id?: string | undefined;
  parent_span_id?: string | undefined;
  correlation_id?: string | undefined;
  causation_id?: string | undefined;
  idempotency_key?: string | undefined;
  priority?: Priority | undefined;
  extensions?: Record<string, unknown> | undefined;
};

/**
 * Strip keys whose value is `undefined`. Required for `exactOptionalPropertyTypes`
 * compatibility when forwarding optional fields onto an envelope literal.
 */
export function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Build a per-type envelope schema. The result is a zod object schema with
 * `type` constrained to the literal `T` and `payload` constrained to `P`.
 *
 * Used inside `messages/*` to define the schema for each protocol message.
 *
 * @example
 * const Ping = messageEnvelope("ping", PingPayloadSchema);
 * type PingEnvelope = z.infer<typeof Ping>;
 */
export function messageEnvelope<T extends string, P extends z.ZodTypeAny>(type: T, payload: P) {
  return BaseEnvelopeSchema.extend({
    type: z.literal(type),
    payload,
  });
}

/**
 * Construct a fresh envelope object literal. Strips undefined optional fields
 * so the result is acceptable under `exactOptionalPropertyTypes`.
 *
 * Validation is the caller's job — the result is shape-typed but not parsed.
 */
export function buildEnvelope<T extends string, P>(args: {
  id: string;
  type: T;
  timestamp: string;
  payload: P;
  optional?: EnvelopeOptionalFields;
}): {
  arcp: typeof PROTOCOL_VERSION;
  id: string;
  type: T;
  timestamp: string;
  payload: P;
} & Partial<EnvelopeOptionalFields> {
  return {
    arcp: PROTOCOL_VERSION,
    id: args.id,
    type: args.type,
    timestamp: args.timestamp,
    ...(args.optional !== undefined ? pickDefined(args.optional) : {}),
    payload: args.payload,
  };
}

/**
 * Round-trip a raw JSON value through the base envelope schema.
 *
 * Returns the parsed envelope shape with all unknown fields preserved (since
 * zod's default mode strips, but we want to keep extension fields intact for
 * the runtime dispatcher).
 */
export const RoundTripEnvelopeSchema = BaseEnvelopeSchema.passthrough();
export type RoundTripEnvelope = z.infer<typeof RoundTripEnvelopeSchema>;
