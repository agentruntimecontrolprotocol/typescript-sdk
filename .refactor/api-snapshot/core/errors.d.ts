import { z } from "zod";
/**
 * Canonical ARCP error codes.
 *
 * v1.0 §12 specified 12 codes. v1.1 §12 adds three more
 * (`AGENT_VERSION_NOT_AVAILABLE`, `LEASE_EXPIRED`, `BUDGET_EXHAUSTED`) for
 * a total of 15.
 *
 * @see ARCP v1.1 §12.
 */
export declare const ERROR_CODES: readonly ["PERMISSION_DENIED", "LEASE_SUBSET_VIOLATION", "JOB_NOT_FOUND", "DUPLICATE_KEY", "AGENT_NOT_AVAILABLE", "AGENT_VERSION_NOT_AVAILABLE", "CANCELLED", "TIMEOUT", "RESUME_WINDOW_EXPIRED", "HEARTBEAT_LOST", "LEASE_EXPIRED", "BUDGET_EXHAUSTED", "INVALID_REQUEST", "UNAUTHENTICATED", "INTERNAL_ERROR"];
/** Union of all canonical ARCP error codes. */
export type ErrorCode = (typeof ERROR_CODES)[number];
/** Type guard: is `value` a canonical error code? */
export declare function isErrorCode(value: unknown): value is ErrorCode;
/** Whether a given error code is retryable by default. */
export declare function isRetryableByDefault(code: ErrorCode): boolean;
/**
 * Wire schema for an ARCP error payload (§12).
 *
 * Shape: `{ code, message, retryable, details? }`. Anything implementation-specific
 * goes inside `details`.
 */
export declare const ErrorPayloadSchema: z.ZodObject<{
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
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
/** Construction options for {@link ARCPError}. */
export interface ARCPErrorOptions {
    message: string;
    code: ErrorCode;
    retryable?: boolean | undefined;
    details?: Record<string, unknown> | undefined;
    cause?: ARCPError | Error | undefined;
}
/**
 * Base error type for all ARCP-internal failures.
 *
 * Always carries a canonical {@link ErrorCode}. Subclasses pin specific codes
 * for ergonomic catches.
 */
export declare class ARCPError extends Error {
    /** Canonical error code. */
    readonly code: ErrorCode;
    /** Whether this error is retryable. Defaults from {@link isRetryableByDefault}. */
    readonly retryable: boolean;
    /** Extra structured detail. */
    readonly details: Readonly<Record<string, unknown>>;
    constructor(opts: ARCPErrorOptions);
    /** Serialize to the wire `ErrorPayload` shape (§12). */
    toPayload(): ErrorPayload;
    /** Re-hydrate an {@link ARCPError} from a wire payload. */
    static fromPayload(payload: ErrorPayload): ARCPError;
}
/** §12 `UNAUTHENTICATED`. Missing or invalid credentials. */
export declare class UnauthenticatedError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `PERMISSION_DENIED`. Operation rejected by lease enforcement. */
export declare class PermissionDeniedError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `LEASE_SUBSET_VIOLATION`. Delegation request expanded beyond parent lease. */
export declare class LeaseSubsetViolationError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `INVALID_REQUEST`. Malformed envelope or payload schema violation. */
export declare class InvalidRequestError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `JOB_NOT_FOUND`. Referenced `job_id` does not exist in this session. */
export declare class JobNotFoundError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `DUPLICATE_KEY`. `idempotency_key` reuse with conflicting parameters. */
export declare class DuplicateKeyError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `AGENT_NOT_AVAILABLE`. Requested `agent` is not registered. */
export declare class AgentNotAvailableError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `TIMEOUT`. Job exceeded `max_runtime_sec` or other deadline. */
export declare class TimeoutError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `RESUME_WINDOW_EXPIRED`. Resume attempted after the buffer window closed. */
export declare class ResumeWindowExpiredError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `CANCELLED`. Operation cancelled by caller, runtime, or policy. */
export declare class CancelledError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `HEARTBEAT_LOST`. Runtime detected client disconnection without close. */
export declare class HeartbeatLostError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/** §12 `INTERNAL_ERROR`. Unrecoverable runtime fault. Always retryable. */
export declare class InternalError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/**
 * v1.1 §12 `LEASE_EXPIRED`. The lease's `expires_at` was reached during
 * execution. Always non-retryable — naive retry will fail identically.
 */
export declare class LeaseExpiredError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/**
 * v1.1 §12 `BUDGET_EXHAUSTED`. A `cost.budget` counter reached zero or below.
 * Always non-retryable — naive retry will fail identically.
 */
export declare class BudgetExhaustedError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
/**
 * v1.1 §12 `AGENT_VERSION_NOT_AVAILABLE`. The agent name resolved but the
 * requested version is not registered. Always non-retryable.
 */
export declare class AgentVersionNotAvailableError extends ARCPError {
    constructor(message: string, opts?: Omit<ARCPErrorOptions, "message" | "code">);
}
//# sourceMappingURL=errors.d.ts.map