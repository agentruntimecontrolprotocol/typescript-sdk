import { Schema } from "effect";

import type {
  EventSeq,
  JobId,
  MessageId,
  SessionId,
  TraceId,
} from "./brands.js";
import { validateExtensionsObject } from "./extensions.js";
import { PROTOCOL_VERSION } from "./version.js";

// ARCP v1.1 §5.1 envelope: `arcp`, `id`, `type`, `session_id`, `trace_id`,
// `job_id`, `event_seq`, `payload`, plus `extensions`.
//
//   - `arcp`        MUST be the current `PROTOCOL_VERSION` literal.
//   - `session_id`  REQUIRED on every envelope EXCEPT `session.hello` and
//                   `session.welcome`. Enforced in `RoundTripEnvelopeSchema`
//                   via a filter, and per-type by the discriminated union.
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
export const EnvelopeExtensionsSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
}).pipe(
  Schema.filter((obj) => {
    try {
      validateExtensionsObject(obj);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }),
);

/** W3C trace-id: 32 lowercase hex characters. */
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;

/** Whether a `trace_id` value is well-formed per §11. */
export function isValidTraceId(value: string): boolean {
  return TRACE_ID_PATTERN.test(value);
}

const TraceIdSchema: Schema.Schema<TraceId, string> = Schema.String.pipe(
  Schema.pattern(TRACE_ID_PATTERN, {
    message: () =>
      "trace_id MUST be 32 lowercase hex characters (W3C Trace Context)",
  }),
);

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

const MessageIdSchema = Schema.String.pipe(
  Schema.nonEmptyString(),
) as unknown as Schema.Schema<MessageId, string>;

const SessionIdInnerSchema = Schema.String as unknown as Schema.Schema<
  SessionId,
  string
>;

const JobIdInnerSchema = Schema.String as unknown as Schema.Schema<
  JobId,
  string
>;

const EventSeqInnerSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
) as unknown as Schema.Schema<EventSeq, number>;

/**
 * Base envelope shape per §5.1. The base layer is permissive: per-type
 * schemas in `messages/` narrow `type` to a literal and `payload` to a
 * specific shape.
 */
export const BaseEnvelopeSchema = Schema.Struct({
  arcp: Schema.Literal(PROTOCOL_VERSION),
  id: MessageIdSchema,
  type: Schema.String.pipe(Schema.nonEmptyString()),
  session_id: Schema.optional(SessionIdInnerSchema),
  job_id: Schema.optional(JobIdInnerSchema),
  trace_id: Schema.optional(TraceIdSchema),
  event_seq: Schema.optional(EventSeqInnerSchema),
  extensions: Schema.optional(EnvelopeExtensionsSchema),
  payload: Schema.Unknown,
});

/**
 * The base envelope, type-only. Specific message envelopes refine this base
 * by overriding `type` to a literal and `payload` to a typed schema.
 */
export type BaseEnvelope = Schema.Schema.Type<typeof BaseEnvelopeSchema>;

/**
 * Optional fields on the base envelope, used to construct envelopes by
 * spreading only the fields that are defined.
 */
// Kept as a type alias (not interface) so it remains assignable to
// `Record<string, unknown>` when spread through `pickDefined`.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type EnvelopeOptionalFields = {
  session_id?: SessionId | undefined;
  job_id?: JobId | undefined;
  trace_id?: TraceId | undefined;
  event_seq?: EventSeq | undefined;
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
 * Build a per-type envelope schema. Returns an Effect `Schema.Struct` with
 * `type` constrained to the literal `T` and `payload` constrained to `P`.
 *
 * The full set of base envelope fields (id, session_id, etc.) is included so
 * the discriminated union over the per-type schemas decodes envelopes
 * end-to-end.
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function messageEnvelope<T extends string, A, I>(
  type: T,
  payload: Schema.Schema<A, I>,
) {
  return Schema.Struct({
    arcp: Schema.Literal(PROTOCOL_VERSION),
    id: MessageIdSchema,
    type: Schema.Literal(type),
    session_id: Schema.optional(SessionIdInnerSchema),
    job_id: Schema.optional(JobIdInnerSchema),
    trace_id: Schema.optional(TraceIdSchema),
    event_seq: Schema.optional(EventSeqInnerSchema),
    extensions: Schema.optional(EnvelopeExtensionsSchema),
    payload,
  });
}

/**
 * Construct a fresh envelope object literal. Strips undefined optional fields
 * so the result is acceptable under `exactOptionalPropertyTypes`.
 */
export function buildEnvelope<T extends string, P>(args: {
  id: MessageId;
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
 * Enforces the session_id requirement from §5.1: present on every envelope
 * except `session.hello` / `session.welcome`. Unknown fields pass through
 * via `Schema.Struct`'s default behavior (extra keys are dropped on
 * decode), so callers that need extensions intact must declare them on the
 * schema (the `extensions` field is preserved).
 */
export const RoundTripEnvelopeSchema = BaseEnvelopeSchema.pipe(
  Schema.filter((env) => {
    if (
      !isPreSessionType(env.type) &&
      (env.session_id === undefined || env.session_id === "")
    ) {
      return {
        path: ["session_id"],
        message: `session_id is REQUIRED on envelopes of type "${env.type}"`,
      };
    }
    return undefined;
  }),
);
export type RoundTripEnvelope = Schema.Schema.Type<
  typeof RoundTripEnvelopeSchema
>;
