import { z } from "zod";
import type { EventSeq, JobId, MessageId, SessionId, TraceId } from "./brands.js";
/**
 * Schema for the `extensions` field on an envelope.
 *
 * Carries any extension namespace keys (validated by
 * {@link validateExtensionsObject}) plus a reserved `optional` boolean.
 */
export declare const EnvelopeExtensionsSchema: z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>;
/** Whether a `trace_id` value is well-formed per §11. */
export declare function isValidTraceId(value: string): boolean;
/** Whether `type` is allowed to omit `session_id`. */
export declare function isPreSessionType(type: string): boolean;
/**
 * Base envelope shape per §5.1.
 *
 * `payload` is `unknown`; per-message-type schemas in `messages/` narrow it
 * to a specific shape via `z.discriminatedUnion("type", [...])` and direct
 * extension of this base.
 */
export declare const BaseEnvelopeSchema: z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    type: z.ZodString;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    payload: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    type: string;
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id?: (string & z.BRAND<"SessionId">) | undefined;
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
    payload?: unknown;
}, {
    type: string;
    arcp: "1";
    id: string;
    session_id?: string | undefined;
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
    payload?: unknown;
}>;
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
export declare function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T>;
/**
 * Build a per-type envelope schema. The result is a zod object schema with
 * `type` constrained to the literal `T` and `payload` constrained to `P`.
 *
 * Inference handles the (complex) ZodObject shape better than writing it out.
 */
export declare function messageEnvelope<T extends string, P extends z.ZodTypeAny>(type: T, payload: P): z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
} & {
    type: z.ZodLiteral<T>;
    payload: P;
}, "strip", z.ZodTypeAny, z.objectUtil.addQuestionMarks<z.baseObjectOutputType<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
} & {
    type: z.ZodLiteral<T>;
    payload: P;
}>, any> extends infer T_1 ? { [k in keyof T_1]: T_1[k]; } : never, z.baseObjectInputType<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
} & {
    type: z.ZodLiteral<T>;
    payload: P;
}> extends infer T_2 ? { [k_1 in keyof T_2]: T_2[k_1]; } : never>;
/**
 * Construct a fresh envelope object literal. Strips undefined optional fields
 * so the result is acceptable under `exactOptionalPropertyTypes`.
 */
export declare function buildEnvelope<T extends string, P>(args: {
    id: MessageId;
    type: T;
    payload: P;
    optional?: EnvelopeOptionalFields;
}): BaseEnvelope & {
    type: T;
    payload: P;
};
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
export declare const RoundTripEnvelopeSchema: z.ZodEffects<z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    type: z.ZodString;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    payload: z.ZodUnknown;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    type: z.ZodString;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    payload: z.ZodUnknown;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    type: z.ZodString;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    payload: z.ZodUnknown;
}, z.ZodTypeAny, "passthrough">>, z.objectOutputType<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    type: z.ZodString;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    payload: z.ZodUnknown;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    type: z.ZodString;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    payload: z.ZodUnknown;
}, z.ZodTypeAny, "passthrough">>;
export type RoundTripEnvelope = z.infer<typeof RoundTripEnvelopeSchema>;
//# sourceMappingURL=envelope.d.ts.map