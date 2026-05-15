/**
 * Aggregate registry of every core message type defined by ARCP v1.0.
 *
 * `EnvelopeSchema` is the discriminated union over `type`. Parsing an inbound
 * envelope through this schema yields a fully-typed envelope value or a
 * `ZodError` on unknown/invalid types.
 */
import { z } from "zod";
export * from "./artifacts.js";
export * from "./control.js";
export * from "./execution.js";
export * from "./session.js";
export * from "./telemetry.js";
export type * from "./types.js";
export declare const EnvelopeSchema: z.ZodDiscriminatedUnion<"type", readonly [z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.submit">;
    payload: z.ZodObject<{
        agent: z.ZodString;
        input: z.ZodUnknown;
        lease_request: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
        lease_constraints: z.ZodOptional<z.ZodObject<{
            expires_at: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            expires_at?: string | undefined;
        }, {
            expires_at?: string | undefined;
        }>>;
        idempotency_key: z.ZodOptional<z.ZodString>;
        max_runtime_sec: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        agent: string;
        input?: unknown;
        lease_request?: Record<string, string[]> | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        idempotency_key?: string | undefined;
        max_runtime_sec?: number | undefined;
    }, {
        agent: string;
        input?: unknown;
        lease_request?: Record<string, string[]> | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        idempotency_key?: string | undefined;
        max_runtime_sec?: number | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "job.submit";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        agent: string;
        input?: unknown;
        lease_request?: Record<string, string[]> | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        idempotency_key?: string | undefined;
        max_runtime_sec?: number | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.submit";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        agent: string;
        input?: unknown;
        lease_request?: Record<string, string[]> | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        idempotency_key?: string | undefined;
        max_runtime_sec?: number | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.accepted">;
    payload: z.ZodObject<{
        job_id: z.ZodBranded<z.ZodString, "JobId">;
        agent: z.ZodOptional<z.ZodString>;
        lease: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
        lease_constraints: z.ZodOptional<z.ZodObject<{
            expires_at: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            expires_at?: string | undefined;
        }, {
            expires_at?: string | undefined;
        }>>;
        budget: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        accepted_at: z.ZodString;
        parent_job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
        delegate_id: z.ZodOptional<z.ZodString>;
        trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    }, "strip", z.ZodTypeAny, {
        job_id: string & z.BRAND<"JobId">;
        lease: Record<string, string[]>;
        accepted_at: string;
        trace_id?: (string & z.BRAND<"TraceId">) | undefined;
        agent?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: (string & z.BRAND<"JobId">) | undefined;
        delegate_id?: string | undefined;
    }, {
        job_id: string;
        lease: Record<string, string[]>;
        accepted_at: string;
        trace_id?: string | undefined;
        agent?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: string | undefined;
        delegate_id?: string | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
}, "strip", z.ZodTypeAny, {
    type: "job.accepted";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    payload: {
        job_id: string & z.BRAND<"JobId">;
        lease: Record<string, string[]>;
        accepted_at: string;
        trace_id?: (string & z.BRAND<"TraceId">) | undefined;
        agent?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: (string & z.BRAND<"JobId">) | undefined;
        delegate_id?: string | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.accepted";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    payload: {
        job_id: string;
        lease: Record<string, string[]>;
        accepted_at: string;
        trace_id?: string | undefined;
        agent?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: string | undefined;
        delegate_id?: string | undefined;
    };
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.cancel">;
    payload: z.ZodObject<{
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        reason?: string | undefined;
    }, {
        reason?: string | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
}, "strip", z.ZodTypeAny, {
    type: "job.cancel";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    payload: {
        reason?: string | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.cancel";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    payload: {
        reason?: string | undefined;
    };
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.event">;
    payload: z.ZodObject<{
        kind: z.ZodString;
        ts: z.ZodString;
        body: z.ZodUnknown;
    }, "strip", z.ZodTypeAny, {
        kind: string;
        ts: string;
        body?: unknown;
    }, {
        kind: string;
        ts: string;
        body?: unknown;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
    event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
}, "strip", z.ZodTypeAny, {
    type: "job.event";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    event_seq: number & z.BRAND<"EventSeq">;
    payload: {
        kind: string;
        ts: string;
        body?: unknown;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.event";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    event_seq: number;
    payload: {
        kind: string;
        ts: string;
        body?: unknown;
    };
    trace_id?: string | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.result">;
    payload: z.ZodObject<{
        final_status: z.ZodLiteral<"success">;
        summary: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodUnknown>;
        result_id: z.ZodOptional<z.ZodString>;
        result_size: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        final_status: "success";
        result_id?: string | undefined;
        summary?: string | undefined;
        result?: unknown;
        result_size?: number | undefined;
    }, {
        final_status: "success";
        result_id?: string | undefined;
        summary?: string | undefined;
        result?: unknown;
        result_size?: number | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
    event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
}, "strip", z.ZodTypeAny, {
    type: "job.result";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    event_seq: number & z.BRAND<"EventSeq">;
    payload: {
        final_status: "success";
        result_id?: string | undefined;
        summary?: string | undefined;
        result?: unknown;
        result_size?: number | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.result";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    event_seq: number;
    payload: {
        final_status: "success";
        result_id?: string | undefined;
        summary?: string | undefined;
        result?: unknown;
        result_size?: number | undefined;
    };
    trace_id?: string | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.error">;
    payload: z.ZodObject<{
        final_status: z.ZodEnum<["error", "cancelled", "timed_out"]>;
        code: z.ZodEnum<["PERMISSION_DENIED", "LEASE_SUBSET_VIOLATION", "JOB_NOT_FOUND", "DUPLICATE_KEY", "AGENT_NOT_AVAILABLE", "AGENT_VERSION_NOT_AVAILABLE", "CANCELLED", "TIMEOUT", "RESUME_WINDOW_EXPIRED", "HEARTBEAT_LOST", "LEASE_EXPIRED", "BUDGET_EXHAUSTED", "INVALID_REQUEST", "UNAUTHENTICATED", "INTERNAL_ERROR"]>;
        message: z.ZodString;
        retryable: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        final_status: "error" | "cancelled" | "timed_out";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }, {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        final_status: "error" | "cancelled" | "timed_out";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
    event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
}, "strip", z.ZodTypeAny, {
    type: "job.error";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    event_seq: number & z.BRAND<"EventSeq">;
    payload: {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        final_status: "error" | "cancelled" | "timed_out";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.error";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    event_seq: number;
    payload: {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        final_status: "error" | "cancelled" | "timed_out";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    trace_id?: string | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.subscribe">;
    payload: z.ZodObject<{
        job_id: z.ZodBranded<z.ZodString, "JobId">;
        from_event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
        history: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        job_id: string & z.BRAND<"JobId">;
        from_event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
        history?: boolean | undefined;
    }, {
        job_id: string;
        from_event_seq?: number | undefined;
        history?: boolean | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "job.subscribe";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        job_id: string & z.BRAND<"JobId">;
        from_event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
        history?: boolean | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.subscribe";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        job_id: string;
        from_event_seq?: number | undefined;
        history?: boolean | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.subscribed">;
    payload: z.ZodObject<{
        job_id: z.ZodBranded<z.ZodString, "JobId">;
        current_status: z.ZodEnum<["pending", "running", "success", "error", "cancelled", "timed_out"]>;
        agent: z.ZodString;
        lease: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
        lease_constraints: z.ZodOptional<z.ZodObject<{
            expires_at: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            expires_at?: string | undefined;
        }, {
            expires_at?: string | undefined;
        }>>;
        budget: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        parent_job_id: z.ZodOptional<z.ZodNullable<z.ZodBranded<z.ZodString, "JobId">>>;
        trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
        subscribed_from: z.ZodBranded<z.ZodNumber, "EventSeq">;
        replayed: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        job_id: string & z.BRAND<"JobId">;
        agent: string;
        lease: Record<string, string[]>;
        current_status: "error" | "pending" | "running" | "success" | "cancelled" | "timed_out";
        subscribed_from: number & z.BRAND<"EventSeq">;
        replayed: boolean;
        trace_id?: (string & z.BRAND<"TraceId">) | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
    }, {
        job_id: string;
        agent: string;
        lease: Record<string, string[]>;
        current_status: "error" | "pending" | "running" | "success" | "cancelled" | "timed_out";
        subscribed_from: number;
        replayed: boolean;
        trace_id?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: string | null | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
}, "strip", z.ZodTypeAny, {
    type: "job.subscribed";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    payload: {
        job_id: string & z.BRAND<"JobId">;
        agent: string;
        lease: Record<string, string[]>;
        current_status: "error" | "pending" | "running" | "success" | "cancelled" | "timed_out";
        subscribed_from: number & z.BRAND<"EventSeq">;
        replayed: boolean;
        trace_id?: (string & z.BRAND<"TraceId">) | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.subscribed";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    payload: {
        job_id: string;
        agent: string;
        lease: Record<string, string[]>;
        current_status: "error" | "pending" | "running" | "success" | "cancelled" | "timed_out";
        subscribed_from: number;
        replayed: boolean;
        trace_id?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: string | null | undefined;
    };
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.unsubscribe">;
    payload: z.ZodObject<{
        job_id: z.ZodBranded<z.ZodString, "JobId">;
    }, "strip", z.ZodTypeAny, {
        job_id: string & z.BRAND<"JobId">;
    }, {
        job_id: string;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "job.unsubscribe";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        job_id: string & z.BRAND<"JobId">;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.unsubscribe";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        job_id: string;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
} & {
    type: z.ZodLiteral<"session.hello">;
    payload: z.ZodObject<{
        client: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
            fingerprint: z.ZodOptional<z.ZodString>;
            principal: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        }, {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        }>;
        auth: z.ZodObject<{
            scheme: z.ZodEnum<["bearer"]>;
            token: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            scheme: "bearer";
            token?: string | undefined;
        }, {
            scheme: "bearer";
            token?: string | undefined;
        }>;
        capabilities: z.ZodOptional<z.ZodObject<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
        resume: z.ZodOptional<z.ZodObject<{
            session_id: z.ZodBranded<z.ZodString, "SessionId">;
            resume_token: z.ZodBranded<z.ZodString, "ResumeToken">;
            last_event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
        }, "strip", z.ZodTypeAny, {
            session_id: string & z.BRAND<"SessionId">;
            resume_token: string & z.BRAND<"ResumeToken">;
            last_event_seq: number & z.BRAND<"EventSeq">;
        }, {
            session_id: string;
            resume_token: string;
            last_event_seq: number;
        }>>;
    }, "strip", z.ZodTypeAny, {
        client: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        };
        auth: {
            scheme: "bearer";
            token?: string | undefined;
        };
        capabilities?: z.objectOutputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resume?: {
            session_id: string & z.BRAND<"SessionId">;
            resume_token: string & z.BRAND<"ResumeToken">;
            last_event_seq: number & z.BRAND<"EventSeq">;
        } | undefined;
    }, {
        client: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        };
        auth: {
            scheme: "bearer";
            token?: string | undefined;
        };
        capabilities?: z.objectInputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resume?: {
            session_id: string;
            resume_token: string;
            last_event_seq: number;
        } | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "session.hello";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    payload: {
        client: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        };
        auth: {
            scheme: "bearer";
            token?: string | undefined;
        };
        capabilities?: z.objectOutputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resume?: {
            session_id: string & z.BRAND<"SessionId">;
            resume_token: string & z.BRAND<"ResumeToken">;
            last_event_seq: number & z.BRAND<"EventSeq">;
        } | undefined;
    };
    session_id?: (string & z.BRAND<"SessionId">) | undefined;
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.hello";
    arcp: "1";
    id: string;
    payload: {
        client: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        };
        auth: {
            scheme: "bearer";
            token?: string | undefined;
        };
        capabilities?: z.objectInputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resume?: {
            session_id: string;
            resume_token: string;
            last_event_seq: number;
        } | undefined;
    };
    session_id?: string | undefined;
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.welcome">;
    payload: z.ZodObject<{
        runtime: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
            fingerprint: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        }, {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        }>;
        resume_token: z.ZodBranded<z.ZodString, "ResumeToken">;
        resume_window_sec: z.ZodNumber;
        heartbeat_interval_sec: z.ZodOptional<z.ZodNumber>;
        capabilities: z.ZodObject<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>;
    }, "strip", z.ZodTypeAny, {
        resume_token: string & z.BRAND<"ResumeToken">;
        capabilities: {
            encodings?: string[] | undefined;
            agents?: string[] | {
                name: string;
                versions: string[];
                default?: string | undefined;
            }[] | undefined;
            features?: string[] | undefined;
        } & {
            [k: string]: unknown;
        };
        runtime: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        };
        resume_window_sec: number;
        heartbeat_interval_sec?: number | undefined;
    }, {
        resume_token: string;
        capabilities: {
            encodings?: string[] | undefined;
            agents?: string[] | {
                name: string;
                versions: string[];
                default?: string | undefined;
            }[] | undefined;
            features?: string[] | undefined;
        } & {
            [k: string]: unknown;
        };
        runtime: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        };
        resume_window_sec: number;
        heartbeat_interval_sec?: number | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.welcome";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        resume_token: string & z.BRAND<"ResumeToken">;
        capabilities: {
            encodings?: string[] | undefined;
            agents?: string[] | {
                name: string;
                versions: string[];
                default?: string | undefined;
            }[] | undefined;
            features?: string[] | undefined;
        } & {
            [k: string]: unknown;
        };
        runtime: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        };
        resume_window_sec: number;
        heartbeat_interval_sec?: number | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.welcome";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        resume_token: string;
        capabilities: {
            encodings?: string[] | undefined;
            agents?: string[] | {
                name: string;
                versions: string[];
                default?: string | undefined;
            }[] | undefined;
            features?: string[] | undefined;
        } & {
            [k: string]: unknown;
        };
        runtime: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        };
        resume_window_sec: number;
        heartbeat_interval_sec?: number | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
} & {
    type: z.ZodLiteral<"session.error">;
    payload: z.ZodObject<{
        code: z.ZodEnum<["PERMISSION_DENIED", "LEASE_SUBSET_VIOLATION", "JOB_NOT_FOUND", "DUPLICATE_KEY", "AGENT_NOT_AVAILABLE", "AGENT_VERSION_NOT_AVAILABLE", "CANCELLED", "TIMEOUT", "RESUME_WINDOW_EXPIRED", "HEARTBEAT_LOST", "LEASE_EXPIRED", "BUDGET_EXHAUSTED", "INVALID_REQUEST", "UNAUTHENTICATED", "INTERNAL_ERROR"]>;
        message: z.ZodString;
        retryable: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }, {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "session.error";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    payload: {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    session_id?: (string & z.BRAND<"SessionId">) | undefined;
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.error";
    arcp: "1";
    id: string;
    payload: {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    session_id?: string | undefined;
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.bye">;
    payload: z.ZodObject<{
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        reason?: string | undefined;
    }, {
        reason?: string | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.bye";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        reason?: string | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.bye";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        reason?: string | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.ping">;
    payload: z.ZodObject<{
        nonce: z.ZodString;
        sent_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        nonce: string;
        sent_at: string;
    }, {
        nonce: string;
        sent_at: string;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.ping";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        nonce: string;
        sent_at: string;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.ping";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        nonce: string;
        sent_at: string;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.pong">;
    payload: z.ZodObject<{
        ping_nonce: z.ZodString;
        received_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        ping_nonce: string;
        received_at: string;
    }, {
        ping_nonce: string;
        received_at: string;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.pong";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        ping_nonce: string;
        received_at: string;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.pong";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        ping_nonce: string;
        received_at: string;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.ack">;
    payload: z.ZodObject<{
        last_processed_seq: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        last_processed_seq: number;
    }, {
        last_processed_seq: number;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.ack";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        last_processed_seq: number;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.ack";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        last_processed_seq: number;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.list_jobs">;
    payload: z.ZodObject<{
        filter: z.ZodOptional<z.ZodObject<{
            status: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agent: z.ZodOptional<z.ZodString>;
            created_after: z.ZodOptional<z.ZodString>;
            created_before: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        }, {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        }>>;
        limit: z.ZodOptional<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        filter?: {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        } | undefined;
        limit?: number | undefined;
        cursor?: string | null | undefined;
    }, {
        filter?: {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        } | undefined;
        limit?: number | undefined;
        cursor?: string | null | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.list_jobs";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        filter?: {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        } | undefined;
        limit?: number | undefined;
        cursor?: string | null | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.list_jobs";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        filter?: {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        } | undefined;
        limit?: number | undefined;
        cursor?: string | null | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.jobs">;
    payload: z.ZodObject<{
        request_id: z.ZodString;
        jobs: z.ZodArray<z.ZodObject<{
            job_id: z.ZodBranded<z.ZodString, "JobId">;
            agent: z.ZodString;
            status: z.ZodString;
            lease: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
            parent_job_id: z.ZodOptional<z.ZodNullable<z.ZodBranded<z.ZodString, "JobId">>>;
            created_at: z.ZodString;
            trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
            last_event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
        }, "strip", z.ZodTypeAny, {
            status: string;
            job_id: string & z.BRAND<"JobId">;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number & z.BRAND<"EventSeq">;
            created_at: string;
            trace_id?: (string & z.BRAND<"TraceId">) | undefined;
            parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
        }, {
            status: string;
            job_id: string;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number;
            created_at: string;
            trace_id?: string | undefined;
            parent_job_id?: string | null | undefined;
        }>, "many">;
        next_cursor: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        request_id: string;
        jobs: {
            status: string;
            job_id: string & z.BRAND<"JobId">;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number & z.BRAND<"EventSeq">;
            created_at: string;
            trace_id?: (string & z.BRAND<"TraceId">) | undefined;
            parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
        }[];
        next_cursor: string | null;
    }, {
        request_id: string;
        jobs: {
            status: string;
            job_id: string;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number;
            created_at: string;
            trace_id?: string | undefined;
            parent_job_id?: string | null | undefined;
        }[];
        next_cursor: string | null;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.jobs";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        request_id: string;
        jobs: {
            status: string;
            job_id: string & z.BRAND<"JobId">;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number & z.BRAND<"EventSeq">;
            created_at: string;
            trace_id?: (string & z.BRAND<"TraceId">) | undefined;
            parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
        }[];
        next_cursor: string | null;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.jobs";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        request_id: string;
        jobs: {
            status: string;
            job_id: string;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number;
            created_at: string;
            trace_id?: string | undefined;
            parent_job_id?: string | null | undefined;
        }[];
        next_cursor: string | null;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}>, ...(z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.submit">;
    payload: z.ZodObject<{
        agent: z.ZodString;
        input: z.ZodUnknown;
        lease_request: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>>;
        lease_constraints: z.ZodOptional<z.ZodObject<{
            expires_at: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            expires_at?: string | undefined;
        }, {
            expires_at?: string | undefined;
        }>>;
        idempotency_key: z.ZodOptional<z.ZodString>;
        max_runtime_sec: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        agent: string;
        input?: unknown;
        lease_request?: Record<string, string[]> | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        idempotency_key?: string | undefined;
        max_runtime_sec?: number | undefined;
    }, {
        agent: string;
        input?: unknown;
        lease_request?: Record<string, string[]> | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        idempotency_key?: string | undefined;
        max_runtime_sec?: number | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "job.submit";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        agent: string;
        input?: unknown;
        lease_request?: Record<string, string[]> | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        idempotency_key?: string | undefined;
        max_runtime_sec?: number | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.submit";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        agent: string;
        input?: unknown;
        lease_request?: Record<string, string[]> | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        idempotency_key?: string | undefined;
        max_runtime_sec?: number | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.accepted">;
    payload: z.ZodObject<{
        job_id: z.ZodBranded<z.ZodString, "JobId">;
        agent: z.ZodOptional<z.ZodString>;
        lease: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
        lease_constraints: z.ZodOptional<z.ZodObject<{
            expires_at: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            expires_at?: string | undefined;
        }, {
            expires_at?: string | undefined;
        }>>;
        budget: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        accepted_at: z.ZodString;
        parent_job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
        delegate_id: z.ZodOptional<z.ZodString>;
        trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    }, "strip", z.ZodTypeAny, {
        job_id: string & z.BRAND<"JobId">;
        lease: Record<string, string[]>;
        accepted_at: string;
        trace_id?: (string & z.BRAND<"TraceId">) | undefined;
        agent?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: (string & z.BRAND<"JobId">) | undefined;
        delegate_id?: string | undefined;
    }, {
        job_id: string;
        lease: Record<string, string[]>;
        accepted_at: string;
        trace_id?: string | undefined;
        agent?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: string | undefined;
        delegate_id?: string | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
}, "strip", z.ZodTypeAny, {
    type: "job.accepted";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    payload: {
        job_id: string & z.BRAND<"JobId">;
        lease: Record<string, string[]>;
        accepted_at: string;
        trace_id?: (string & z.BRAND<"TraceId">) | undefined;
        agent?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: (string & z.BRAND<"JobId">) | undefined;
        delegate_id?: string | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.accepted";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    payload: {
        job_id: string;
        lease: Record<string, string[]>;
        accepted_at: string;
        trace_id?: string | undefined;
        agent?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: string | undefined;
        delegate_id?: string | undefined;
    };
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.cancel">;
    payload: z.ZodObject<{
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        reason?: string | undefined;
    }, {
        reason?: string | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
}, "strip", z.ZodTypeAny, {
    type: "job.cancel";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    payload: {
        reason?: string | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.cancel";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    payload: {
        reason?: string | undefined;
    };
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.event">;
    payload: z.ZodObject<{
        kind: z.ZodString;
        ts: z.ZodString;
        body: z.ZodUnknown;
    }, "strip", z.ZodTypeAny, {
        kind: string;
        ts: string;
        body?: unknown;
    }, {
        kind: string;
        ts: string;
        body?: unknown;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
    event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
}, "strip", z.ZodTypeAny, {
    type: "job.event";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    event_seq: number & z.BRAND<"EventSeq">;
    payload: {
        kind: string;
        ts: string;
        body?: unknown;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.event";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    event_seq: number;
    payload: {
        kind: string;
        ts: string;
        body?: unknown;
    };
    trace_id?: string | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.result">;
    payload: z.ZodObject<{
        final_status: z.ZodLiteral<"success">;
        summary: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodUnknown>;
        result_id: z.ZodOptional<z.ZodString>;
        result_size: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        final_status: "success";
        result_id?: string | undefined;
        summary?: string | undefined;
        result?: unknown;
        result_size?: number | undefined;
    }, {
        final_status: "success";
        result_id?: string | undefined;
        summary?: string | undefined;
        result?: unknown;
        result_size?: number | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
    event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
}, "strip", z.ZodTypeAny, {
    type: "job.result";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    event_seq: number & z.BRAND<"EventSeq">;
    payload: {
        final_status: "success";
        result_id?: string | undefined;
        summary?: string | undefined;
        result?: unknown;
        result_size?: number | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.result";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    event_seq: number;
    payload: {
        final_status: "success";
        result_id?: string | undefined;
        summary?: string | undefined;
        result?: unknown;
        result_size?: number | undefined;
    };
    trace_id?: string | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.error">;
    payload: z.ZodObject<{
        final_status: z.ZodEnum<["error", "cancelled", "timed_out"]>;
        code: z.ZodEnum<["PERMISSION_DENIED", "LEASE_SUBSET_VIOLATION", "JOB_NOT_FOUND", "DUPLICATE_KEY", "AGENT_NOT_AVAILABLE", "AGENT_VERSION_NOT_AVAILABLE", "CANCELLED", "TIMEOUT", "RESUME_WINDOW_EXPIRED", "HEARTBEAT_LOST", "LEASE_EXPIRED", "BUDGET_EXHAUSTED", "INVALID_REQUEST", "UNAUTHENTICATED", "INTERNAL_ERROR"]>;
        message: z.ZodString;
        retryable: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        final_status: "error" | "cancelled" | "timed_out";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }, {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        final_status: "error" | "cancelled" | "timed_out";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
    event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
}, "strip", z.ZodTypeAny, {
    type: "job.error";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    event_seq: number & z.BRAND<"EventSeq">;
    payload: {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        final_status: "error" | "cancelled" | "timed_out";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.error";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    event_seq: number;
    payload: {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        final_status: "error" | "cancelled" | "timed_out";
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    trace_id?: string | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.subscribe">;
    payload: z.ZodObject<{
        job_id: z.ZodBranded<z.ZodString, "JobId">;
        from_event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
        history: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        job_id: string & z.BRAND<"JobId">;
        from_event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
        history?: boolean | undefined;
    }, {
        job_id: string;
        from_event_seq?: number | undefined;
        history?: boolean | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "job.subscribe";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        job_id: string & z.BRAND<"JobId">;
        from_event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
        history?: boolean | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.subscribe";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        job_id: string;
        from_event_seq?: number | undefined;
        history?: boolean | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.subscribed">;
    payload: z.ZodObject<{
        job_id: z.ZodBranded<z.ZodString, "JobId">;
        current_status: z.ZodEnum<["pending", "running", "success", "error", "cancelled", "timed_out"]>;
        agent: z.ZodString;
        lease: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
        lease_constraints: z.ZodOptional<z.ZodObject<{
            expires_at: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            expires_at?: string | undefined;
        }, {
            expires_at?: string | undefined;
        }>>;
        budget: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        parent_job_id: z.ZodOptional<z.ZodNullable<z.ZodBranded<z.ZodString, "JobId">>>;
        trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
        subscribed_from: z.ZodBranded<z.ZodNumber, "EventSeq">;
        replayed: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        job_id: string & z.BRAND<"JobId">;
        agent: string;
        lease: Record<string, string[]>;
        current_status: "error" | "pending" | "running" | "success" | "cancelled" | "timed_out";
        subscribed_from: number & z.BRAND<"EventSeq">;
        replayed: boolean;
        trace_id?: (string & z.BRAND<"TraceId">) | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
    }, {
        job_id: string;
        agent: string;
        lease: Record<string, string[]>;
        current_status: "error" | "pending" | "running" | "success" | "cancelled" | "timed_out";
        subscribed_from: number;
        replayed: boolean;
        trace_id?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: string | null | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
    job_id: z.ZodBranded<z.ZodString, "JobId">;
}, "strip", z.ZodTypeAny, {
    type: "job.subscribed";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    job_id: string & z.BRAND<"JobId">;
    payload: {
        job_id: string & z.BRAND<"JobId">;
        agent: string;
        lease: Record<string, string[]>;
        current_status: "error" | "pending" | "running" | "success" | "cancelled" | "timed_out";
        subscribed_from: number & z.BRAND<"EventSeq">;
        replayed: boolean;
        trace_id?: (string & z.BRAND<"TraceId">) | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
    };
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.subscribed";
    arcp: "1";
    id: string;
    session_id: string;
    job_id: string;
    payload: {
        job_id: string;
        agent: string;
        lease: Record<string, string[]>;
        current_status: "error" | "pending" | "running" | "success" | "cancelled" | "timed_out";
        subscribed_from: number;
        replayed: boolean;
        trace_id?: string | undefined;
        lease_constraints?: {
            expires_at?: string | undefined;
        } | undefined;
        budget?: Record<string, number> | undefined;
        parent_job_id?: string | null | undefined;
    };
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"job.unsubscribe">;
    payload: z.ZodObject<{
        job_id: z.ZodBranded<z.ZodString, "JobId">;
    }, "strip", z.ZodTypeAny, {
        job_id: string & z.BRAND<"JobId">;
    }, {
        job_id: string;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "job.unsubscribe";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        job_id: string & z.BRAND<"JobId">;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "job.unsubscribe";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        job_id: string;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
} & {
    type: z.ZodLiteral<"session.hello">;
    payload: z.ZodObject<{
        client: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
            fingerprint: z.ZodOptional<z.ZodString>;
            principal: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        }, {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        }>;
        auth: z.ZodObject<{
            scheme: z.ZodEnum<["bearer"]>;
            token: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            scheme: "bearer";
            token?: string | undefined;
        }, {
            scheme: "bearer";
            token?: string | undefined;
        }>;
        capabilities: z.ZodOptional<z.ZodObject<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
        resume: z.ZodOptional<z.ZodObject<{
            session_id: z.ZodBranded<z.ZodString, "SessionId">;
            resume_token: z.ZodBranded<z.ZodString, "ResumeToken">;
            last_event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
        }, "strip", z.ZodTypeAny, {
            session_id: string & z.BRAND<"SessionId">;
            resume_token: string & z.BRAND<"ResumeToken">;
            last_event_seq: number & z.BRAND<"EventSeq">;
        }, {
            session_id: string;
            resume_token: string;
            last_event_seq: number;
        }>>;
    }, "strip", z.ZodTypeAny, {
        client: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        };
        auth: {
            scheme: "bearer";
            token?: string | undefined;
        };
        capabilities?: z.objectOutputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resume?: {
            session_id: string & z.BRAND<"SessionId">;
            resume_token: string & z.BRAND<"ResumeToken">;
            last_event_seq: number & z.BRAND<"EventSeq">;
        } | undefined;
    }, {
        client: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        };
        auth: {
            scheme: "bearer";
            token?: string | undefined;
        };
        capabilities?: z.objectInputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resume?: {
            session_id: string;
            resume_token: string;
            last_event_seq: number;
        } | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "session.hello";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    payload: {
        client: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        };
        auth: {
            scheme: "bearer";
            token?: string | undefined;
        };
        capabilities?: z.objectOutputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resume?: {
            session_id: string & z.BRAND<"SessionId">;
            resume_token: string & z.BRAND<"ResumeToken">;
            last_event_seq: number & z.BRAND<"EventSeq">;
        } | undefined;
    };
    session_id?: (string & z.BRAND<"SessionId">) | undefined;
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.hello";
    arcp: "1";
    id: string;
    payload: {
        client: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
            principal?: string | undefined;
        };
        auth: {
            scheme: "bearer";
            token?: string | undefined;
        };
        capabilities?: z.objectInputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resume?: {
            session_id: string;
            resume_token: string;
            last_event_seq: number;
        } | undefined;
    };
    session_id?: string | undefined;
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.welcome">;
    payload: z.ZodObject<{
        runtime: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
            fingerprint: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        }, {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        }>;
        resume_token: z.ZodBranded<z.ZodString, "ResumeToken">;
        resume_window_sec: z.ZodNumber;
        heartbeat_interval_sec: z.ZodOptional<z.ZodNumber>;
        capabilities: z.ZodObject<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            encodings: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agents: z.ZodOptional<z.ZodUnion<[z.ZodArray<z.ZodString, "many">, z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                versions: z.ZodArray<z.ZodString, "many">;
                default: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }, {
                name: string;
                versions: string[];
                default?: string | undefined;
            }>, "many">]>>;
            features: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>;
    }, "strip", z.ZodTypeAny, {
        resume_token: string & z.BRAND<"ResumeToken">;
        capabilities: {
            encodings?: string[] | undefined;
            agents?: string[] | {
                name: string;
                versions: string[];
                default?: string | undefined;
            }[] | undefined;
            features?: string[] | undefined;
        } & {
            [k: string]: unknown;
        };
        runtime: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        };
        resume_window_sec: number;
        heartbeat_interval_sec?: number | undefined;
    }, {
        resume_token: string;
        capabilities: {
            encodings?: string[] | undefined;
            agents?: string[] | {
                name: string;
                versions: string[];
                default?: string | undefined;
            }[] | undefined;
            features?: string[] | undefined;
        } & {
            [k: string]: unknown;
        };
        runtime: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        };
        resume_window_sec: number;
        heartbeat_interval_sec?: number | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.welcome";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        resume_token: string & z.BRAND<"ResumeToken">;
        capabilities: {
            encodings?: string[] | undefined;
            agents?: string[] | {
                name: string;
                versions: string[];
                default?: string | undefined;
            }[] | undefined;
            features?: string[] | undefined;
        } & {
            [k: string]: unknown;
        };
        runtime: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        };
        resume_window_sec: number;
        heartbeat_interval_sec?: number | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.welcome";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        resume_token: string;
        capabilities: {
            encodings?: string[] | undefined;
            agents?: string[] | {
                name: string;
                versions: string[];
                default?: string | undefined;
            }[] | undefined;
            features?: string[] | undefined;
        } & {
            [k: string]: unknown;
        };
        runtime: {
            name: string;
            version: string;
            fingerprint?: string | undefined;
        };
        resume_window_sec: number;
        heartbeat_interval_sec?: number | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    session_id: z.ZodOptional<z.ZodBranded<z.ZodString, "SessionId">>;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
} & {
    type: z.ZodLiteral<"session.error">;
    payload: z.ZodObject<{
        code: z.ZodEnum<["PERMISSION_DENIED", "LEASE_SUBSET_VIOLATION", "JOB_NOT_FOUND", "DUPLICATE_KEY", "AGENT_NOT_AVAILABLE", "AGENT_VERSION_NOT_AVAILABLE", "CANCELLED", "TIMEOUT", "RESUME_WINDOW_EXPIRED", "HEARTBEAT_LOST", "LEASE_EXPIRED", "BUDGET_EXHAUSTED", "INVALID_REQUEST", "UNAUTHENTICATED", "INTERNAL_ERROR"]>;
        message: z.ZodString;
        retryable: z.ZodOptional<z.ZodBoolean>;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }, {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "session.error";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    payload: {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    session_id?: (string & z.BRAND<"SessionId">) | undefined;
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.error";
    arcp: "1";
    id: string;
    payload: {
        code: "PERMISSION_DENIED" | "LEASE_SUBSET_VIOLATION" | "JOB_NOT_FOUND" | "DUPLICATE_KEY" | "AGENT_NOT_AVAILABLE" | "AGENT_VERSION_NOT_AVAILABLE" | "CANCELLED" | "TIMEOUT" | "RESUME_WINDOW_EXPIRED" | "HEARTBEAT_LOST" | "LEASE_EXPIRED" | "BUDGET_EXHAUSTED" | "INVALID_REQUEST" | "UNAUTHENTICATED" | "INTERNAL_ERROR";
        message: string;
        retryable?: boolean | undefined;
        details?: Record<string, unknown> | undefined;
    };
    session_id?: string | undefined;
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.bye">;
    payload: z.ZodObject<{
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        reason?: string | undefined;
    }, {
        reason?: string | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.bye";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        reason?: string | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.bye";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        reason?: string | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.ping">;
    payload: z.ZodObject<{
        nonce: z.ZodString;
        sent_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        nonce: string;
        sent_at: string;
    }, {
        nonce: string;
        sent_at: string;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.ping";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        nonce: string;
        sent_at: string;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.ping";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        nonce: string;
        sent_at: string;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.pong">;
    payload: z.ZodObject<{
        ping_nonce: z.ZodString;
        received_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        ping_nonce: string;
        received_at: string;
    }, {
        ping_nonce: string;
        received_at: string;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.pong";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        ping_nonce: string;
        received_at: string;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.pong";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        ping_nonce: string;
        received_at: string;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.ack">;
    payload: z.ZodObject<{
        last_processed_seq: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        last_processed_seq: number;
    }, {
        last_processed_seq: number;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.ack";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        last_processed_seq: number;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.ack";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        last_processed_seq: number;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.list_jobs">;
    payload: z.ZodObject<{
        filter: z.ZodOptional<z.ZodObject<{
            status: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            agent: z.ZodOptional<z.ZodString>;
            created_after: z.ZodOptional<z.ZodString>;
            created_before: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        }, {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        }>>;
        limit: z.ZodOptional<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        filter?: {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        } | undefined;
        limit?: number | undefined;
        cursor?: string | null | undefined;
    }, {
        filter?: {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        } | undefined;
        limit?: number | undefined;
        cursor?: string | null | undefined;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.list_jobs";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        filter?: {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        } | undefined;
        limit?: number | undefined;
        cursor?: string | null | undefined;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.list_jobs";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        filter?: {
            status?: string[] | undefined;
            agent?: string | undefined;
            created_after?: string | undefined;
            created_before?: string | undefined;
        } | undefined;
        limit?: number | undefined;
        cursor?: string | null | undefined;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}> | z.ZodObject<{
    arcp: z.ZodLiteral<"1">;
    id: z.ZodBranded<z.ZodString, "MessageId">;
    job_id: z.ZodOptional<z.ZodBranded<z.ZodString, "JobId">>;
    trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
    event_seq: z.ZodOptional<z.ZodBranded<z.ZodNumber, "EventSeq">>;
    extensions: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>>;
    type: z.ZodLiteral<"session.jobs">;
    payload: z.ZodObject<{
        request_id: z.ZodString;
        jobs: z.ZodArray<z.ZodObject<{
            job_id: z.ZodBranded<z.ZodString, "JobId">;
            agent: z.ZodString;
            status: z.ZodString;
            lease: z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString, "many">>;
            parent_job_id: z.ZodOptional<z.ZodNullable<z.ZodBranded<z.ZodString, "JobId">>>;
            created_at: z.ZodString;
            trace_id: z.ZodOptional<z.ZodBranded<z.ZodString, "TraceId">>;
            last_event_seq: z.ZodBranded<z.ZodNumber, "EventSeq">;
        }, "strip", z.ZodTypeAny, {
            status: string;
            job_id: string & z.BRAND<"JobId">;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number & z.BRAND<"EventSeq">;
            created_at: string;
            trace_id?: (string & z.BRAND<"TraceId">) | undefined;
            parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
        }, {
            status: string;
            job_id: string;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number;
            created_at: string;
            trace_id?: string | undefined;
            parent_job_id?: string | null | undefined;
        }>, "many">;
        next_cursor: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        request_id: string;
        jobs: {
            status: string;
            job_id: string & z.BRAND<"JobId">;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number & z.BRAND<"EventSeq">;
            created_at: string;
            trace_id?: (string & z.BRAND<"TraceId">) | undefined;
            parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
        }[];
        next_cursor: string | null;
    }, {
        request_id: string;
        jobs: {
            status: string;
            job_id: string;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number;
            created_at: string;
            trace_id?: string | undefined;
            parent_job_id?: string | null | undefined;
        }[];
        next_cursor: string | null;
    }>;
} & {
    session_id: z.ZodBranded<z.ZodString, "SessionId">;
}, "strip", z.ZodTypeAny, {
    type: "session.jobs";
    arcp: "1";
    id: string & z.BRAND<"MessageId">;
    session_id: string & z.BRAND<"SessionId">;
    payload: {
        request_id: string;
        jobs: {
            status: string;
            job_id: string & z.BRAND<"JobId">;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number & z.BRAND<"EventSeq">;
            created_at: string;
            trace_id?: (string & z.BRAND<"TraceId">) | undefined;
            parent_job_id?: (string & z.BRAND<"JobId">) | null | undefined;
        }[];
        next_cursor: string | null;
    };
    job_id?: (string & z.BRAND<"JobId">) | undefined;
    trace_id?: (string & z.BRAND<"TraceId">) | undefined;
    event_seq?: (number & z.BRAND<"EventSeq">) | undefined;
    extensions?: Record<string, unknown> | undefined;
}, {
    type: "session.jobs";
    arcp: "1";
    id: string;
    session_id: string;
    payload: {
        request_id: string;
        jobs: {
            status: string;
            job_id: string;
            agent: string;
            lease: Record<string, string[]>;
            last_event_seq: number;
            created_at: string;
            trace_id?: string | undefined;
            parent_job_id?: string | null | undefined;
        }[];
        next_cursor: string | null;
    };
    job_id?: string | undefined;
    trace_id?: string | undefined;
    event_seq?: number | undefined;
    extensions?: Record<string, unknown> | undefined;
}>)[]]>;
export type Envelope = z.infer<typeof EnvelopeSchema>;
//# sourceMappingURL=index.d.ts.map