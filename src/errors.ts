import { z } from "zod";

/**
 * Canonical ARCP error codes.
 *
 * @see RFC-0001-v2.md §18.2.
 */
export const ERROR_CODES = [
  "OK",
  "CANCELLED",
  "UNKNOWN",
  "INVALID_ARGUMENT",
  "DEADLINE_EXCEEDED",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "ABORTED",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DATA_LOSS",
  "UNAUTHENTICATED",
  "HEARTBEAT_LOST",
  "LEASE_EXPIRED",
  "LEASE_REVOKED",
  "BACKPRESSURE_OVERFLOW",
] as const;

/** Union of all canonical ARCP error codes. */
export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

/** Type guard: is `value` a canonical error code? */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

/**
 * `RATE_LIMITED` is an alias for `RESOURCE_EXHAUSTED` per §18.2.
 * Kept as a constant for clarity at call sites that want the alias name.
 */
export const RATE_LIMITED: ErrorCode = "RESOURCE_EXHAUSTED";

/**
 * Default retryability per §18.3. Codes not listed here default to non-retryable.
 */
const RETRYABLE_BY_DEFAULT: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "INTERNAL",
  "ABORTED",
]);

/** Whether a given error code is retryable by default per §18.3. */
export function isRetryableByDefault(code: ErrorCode): boolean {
  return RETRYABLE_BY_DEFAULT.has(code);
}

/**
 * Wire schema for an ARCP error payload (e.g. inside `tool.error`,
 * `job.failed`, `nack`, `stream.error`).
 *
 * @see RFC-0001-v2.md §18.1.
 */
export const ErrorPayloadSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  cause: z.lazy((): z.ZodTypeAny => ErrorPayloadSchema).optional(),
  trace_id: z.string().optional(),
});

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

/** Construction options for {@link ARCPError}. */
export interface ARCPErrorOptions {
  message: string;
  code: ErrorCode;
  retryable?: boolean | undefined;
  details?: Record<string, unknown> | undefined;
  cause?: ARCPError | Error | undefined;
  traceId?: string | undefined;
}

/**
 * Base error type for all ARCP-internal failures.
 *
 * Always carries a canonical {@link ErrorCode}. Subclasses pin specific codes
 * for ergonomic catches.
 *
 * @see RFC-0001-v2.md §18.
 */
export class ARCPError extends Error {
  /** Canonical error code (§18.2). */
  public readonly code: ErrorCode;
  /** Whether this error is retryable. Defaults from §18.3. */
  public readonly retryable: boolean;
  /** Extra structured detail. */
  public readonly details: Readonly<Record<string, unknown>>;
  /** Trace id for correlation, if known. */
  public readonly traceId: string | undefined;

  constructor(opts: ARCPErrorOptions) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "ARCPError";
    this.code = opts.code;
    this.retryable = opts.retryable ?? isRetryableByDefault(opts.code);
    this.details = Object.freeze({ ...(opts.details ?? {}) });
    this.traceId = opts.traceId;
  }

  /** Serialize to the wire `ErrorPayload` shape. */
  public toPayload(): ErrorPayload {
    const cause = this.cause;
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(Object.keys(this.details).length > 0 ? { details: { ...this.details } } : {}),
      ...(cause instanceof ARCPError ? { cause: cause.toPayload() } : {}),
      ...(this.traceId !== undefined ? { trace_id: this.traceId } : {}),
    };
  }

  private static readonly MAX_CAUSE_DEPTH = 16;

  /** Re-hydrate an {@link ARCPError} from a wire payload. */
  public static fromPayload(payload: ErrorPayload): ARCPError {
    return ARCPError.fromPayloadDepth(payload, 0);
  }

  private static fromPayloadDepth(payload: ErrorPayload, depth: number): ARCPError {
    const cause =
      payload.cause === undefined
        ? undefined
        : depth >= ARCPError.MAX_CAUSE_DEPTH
          ? new ARCPError({
              code: "INTERNAL",
              message: "error cause chain exceeded maximum depth",
            })
          : ARCPError.fromPayloadDepth(payload.cause, depth + 1);
    return new ARCPError({
      code: payload.code,
      message: payload.message,
      ...(payload.retryable !== undefined ? { retryable: payload.retryable } : {}),
      ...(payload.details !== undefined ? { details: payload.details } : {}),
      ...(cause !== undefined ? { cause } : {}),
      ...(payload.trace_id !== undefined ? { traceId: payload.trace_id } : {}),
    });
  }
}

/** §18.2 `UNAUTHENTICATED`. Missing or invalid credentials. */
export class UnauthenticatedError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "UNAUTHENTICATED", message });
    this.name = "UnauthenticatedError";
  }
}

/** §18.2 `PERMISSION_DENIED`. Caller lacks required permission or lease. */
export class PermissionDeniedError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "PERMISSION_DENIED", message });
    this.name = "PermissionDeniedError";
  }
}

/** §18.2 `LEASE_EXPIRED`. Operation attempted with expired lease. */
export class LeaseExpiredError extends PermissionDeniedError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super(message, opts);
    Object.defineProperty(this, "code", { value: "LEASE_EXPIRED", enumerable: true });
    this.name = "LeaseExpiredError";
  }
}

/** §18.2 `LEASE_REVOKED`. Operation attempted with revoked lease. */
export class LeaseRevokedError extends PermissionDeniedError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super(message, opts);
    Object.defineProperty(this, "code", { value: "LEASE_REVOKED", enumerable: true });
    this.name = "LeaseRevokedError";
  }
}

/** §18.2 `INVALID_ARGUMENT`. Caller passed a malformed or invalid argument. */
export class InvalidArgumentError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "INVALID_ARGUMENT", message });
    this.name = "InvalidArgumentError";
  }
}

/** §18.2 `NOT_FOUND`. Referenced entity does not exist. */
export class NotFoundError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "NOT_FOUND", message });
    this.name = "NotFoundError";
  }
}

/** §18.2 `FAILED_PRECONDITION`. Pre-condition unmet. */
export class FailedPreconditionError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "FAILED_PRECONDITION", message });
    this.name = "FailedPreconditionError";
  }
}

/** §18.2 `DEADLINE_EXCEEDED`. Operation timed out before completion. */
export class DeadlineExceededError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "DEADLINE_EXCEEDED", message });
    this.name = "DeadlineExceededError";
  }
}

/** §18.2 `CANCELLED`. Operation cancelled by caller, runtime, or policy. */
export class CancelledError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "CANCELLED", message });
    this.name = "CancelledError";
  }
}

/** §18.2 `ABORTED`. Concurrency conflict or hard termination. */
export class AbortedError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "ABORTED", message });
    this.name = "AbortedError";
  }
}

/** §18.2 `HEARTBEAT_LOST`. Job missed required heartbeats (§10.3). */
export class HeartbeatLostError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "HEARTBEAT_LOST", message });
    this.name = "HeartbeatLostError";
  }
}

/** §18.2 `UNIMPLEMENTED`. Feature not supported by this runtime. */
export class NotImplementedError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "UNIMPLEMENTED", message });
    this.name = "NotImplementedError";
  }
}

/** §18.2 `INTERNAL`. Internal runtime error. */
export class InternalError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "INTERNAL", message });
    this.name = "InternalError";
  }
}

/** §18.2 `BACKPRESSURE_OVERFLOW`. Subscription or stream dropped due to overflow. */
export class BackpressureOverflowError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "BACKPRESSURE_OVERFLOW", message });
    this.name = "BackpressureOverflowError";
  }
}

/** §18.2 `DATA_LOSS`. Unrecoverable data loss or corruption. */
export class DataLossError extends ARCPError {
  constructor(message: string, opts: Omit<ARCPErrorOptions, "message" | "code"> = {}) {
    super({ ...opts, code: "DATA_LOSS", message });
    this.name = "DataLossError";
  }
}
