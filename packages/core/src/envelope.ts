import { z } from "zod";

import { validateExtensionsObject } from "./extensions.js";
import { PROTOCOL_VERSION } from "./version.js";

// ARCP v1.0 §5.1 envelope: `arcp`, `id`, `type`, `session_id`, `trace_id`,
// `job_id`, `event_seq`, `payload`, plus `extensions`.
//
//   - `arcp`        MUST be the literal `"1"`.
//   - `session_id`  REQUIRED on every envelope EXCEPT `session.hello` and
//                   `session.welcome`. Enforced in `RoundTripEnvelopeSchema`
//                   via a refine, and per-type by the discriminated union.
//   - `trace_id`    OPTIONAL. When present, MUST be 32 lowercase hex chars.
//   - `event_seq`   REQUIRED on `job.event` / `job.result` / `job.error`.
//                   At the base envelope level it is OPTIONAL; per-type
//                   schemas tighten the constraint where required.

/**
 * Schema for the `extensions` field on an envelope.
 *
 * Carries any extension namespace keys (validated by
 * {@link validateExtensionsObject}) plus a reserved `optional` boolean.
 */
export const EnvelopeExtensionsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((obj, ctx) => {
    try {
      validateExtensionsObject(obj);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

/** W3C trace-id: 32 lowercase hex characters. */
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;

/** Whether a `trace_id` value is well-formed per §11. */
export function isValidTraceId(value: string): boolean {
  return TRACE_ID_PATTERN.test(value);
}

const TraceIdSchema = z.string().regex(TRACE_ID_PATTERN, {
  message: "trace_id MUST be 32 lowercase hex characters (W3C Trace Context)",
});

/**
 * Types where `session_id` is OPTIONAL on the wire (pre-welcome handshake).
 * Every other type MUST carry `session_id`.
 */
const PRE_SESSION_TYPES: ReadonlySet<string> = new Set([
  "session.hello",
  "session.welcome",
]);

/** Whether `type` is allowed to omit `session_id`. */
export function isPreSessionType(type: string): boolean {
  return PRE_SESSION_TYPES.has(type);
}

/**
 * Base envelope shape per §5.1.
 *
 * `payload` is `unknown`; per-message-type schemas in `messages/` narrow it
 * to a specific shape via `z.discriminatedUnion("type", [...])` and direct
 * extension of this base.
 */
export const BaseEnvelopeSchema = z.object({
  arcp: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  type: z.string().min(1),
  session_id: z.string().optional(),
  job_id: z.string().optional(),
  trace_id: TraceIdSchema.optional(),
  event_seq: z.number().int().nonnegative().optional(),
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
// Kept as a type alias (not interface) so it remains assignable to
// `Record<string, unknown>` when spread through `pickDefined`.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type EnvelopeOptionalFields = {
  session_id?: string | undefined;
  job_id?: string | undefined;
  trace_id?: string | undefined;
  event_seq?: number | undefined;
  extensions?: Record<string, unknown> | undefined;
};

/**
 * Strip keys whose value is `undefined`. Required for `exactOptionalPropertyTypes`
 * compatibility when forwarding optional fields onto an envelope literal.
 */
export function pickDefined<T extends Record<string, unknown>>(
  obj: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
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
 * Inference handles the (complex) ZodObject shape better than writing it out.
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function messageEnvelope<T extends string, P extends z.ZodTypeAny>(
  type: T,
  payload: P,
) {
  return BaseEnvelopeSchema.extend({
    type: z.literal(type),
    payload,
  });
}

/**
 * Construct a fresh envelope object literal. Strips undefined optional fields
 * so the result is acceptable under `exactOptionalPropertyTypes`.
 */
export function buildEnvelope<T extends string, P>(args: {
  id: string;
  type: T;
  payload: P;
  optional?: EnvelopeOptionalFields;
}): BaseEnvelope & { type: T; payload: P } {
  const env = {
    arcp: PROTOCOL_VERSION,
    id: args.id,
    type: args.type,
    ...(args.optional === undefined ? {} : pickDefined(args.optional)),
    payload: args.payload,
  };
  return env;
}

/**
 * Round-trip a raw JSON value through the base envelope schema.
 *
 * Returns the parsed envelope shape with all unknown fields preserved (since
 * zod's default mode strips, but we want to keep extension fields intact for
 * the runtime dispatcher).
 *
 * Enforces the session_id requirement from §5.1: present on every envelope
 * except `session.hello` / `session.welcome`.
 */
export const RoundTripEnvelopeSchema =
  BaseEnvelopeSchema.passthrough().superRefine((env, ctx) => {
    if (
      !isPreSessionType(env.type) &&
      (env.session_id === undefined || env.session_id === "")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `session_id is REQUIRED on envelopes of type "${env.type}"`,
        path: ["session_id"],
      });
    }
  });
export type RoundTripEnvelope = z.infer<typeof RoundTripEnvelopeSchema>;
