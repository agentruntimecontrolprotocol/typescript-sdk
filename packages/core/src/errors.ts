import { Schema } from "effect";

/**
 * Canonical ARCP error codes.
 *
 * v1.0 §12 specified 12 codes. v1.1 §12 adds three more
 * (`AGENT_VERSION_NOT_AVAILABLE`, `LEASE_EXPIRED`, `BUDGET_EXHAUSTED`) for
 * a total of 15.
 *
 * @see ARCP v1.1 §12.
 */
export const ERROR_CODES = [
  "PERMISSION_DENIED",
  "LEASE_SUBSET_VIOLATION",
  "JOB_NOT_FOUND",
  "DUPLICATE_KEY",
  "AGENT_NOT_AVAILABLE",
  "AGENT_VERSION_NOT_AVAILABLE",
  "CANCELLED",
  "TIMEOUT",
  "RESUME_WINDOW_EXPIRED",
  "HEARTBEAT_LOST",
  "LEASE_EXPIRED",
  "BUDGET_EXHAUSTED",
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "INTERNAL_ERROR",
] as const;

/** Union of all canonical ARCP error codes. */
export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

/** Type guard: is `value` a canonical error code? */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

/**
 * Default retryability. Only `INTERNAL_ERROR` is unconditionally retryable
 * per §12; `TIMEOUT` is retryable as a default but transport-level concerns
 * may override.
 */
const RETRYABLE_BY_DEFAULT: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "INTERNAL_ERROR",
  "TIMEOUT",
]);

/** Whether a given error code is retryable by default. */
export function isRetryableByDefault(code: ErrorCode): boolean {
  return RETRYABLE_BY_DEFAULT.has(code);
}

/**
 * Wire schema for an ARCP error payload (§12).
 *
 * Shape: `{ code, message, retryable, details? }`. Anything implementation-specific
 * goes inside `details`.
 */
export const ErrorPayloadSchema = Schema.Struct({
  code: Schema.Literal(...ERROR_CODES),
  message: Schema.String.pipe(Schema.nonEmptyString()),
  retryable: Schema.optional(Schema.Boolean),
  details: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});

export type ErrorPayload = Schema.Schema.Type<typeof ErrorPayloadSchema>;

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
export class ARCPError extends Error {
  /** Canonical error code. */
  public readonly code: ErrorCode;
  /** Whether this error is retryable. Defaults from {@link isRetryableByDefault}. */
  public readonly retryable: boolean;
  /** Extra structured detail. */
  public readonly details: Readonly<Record<string, unknown>>;

  constructor(opts: ARCPErrorOptions) {
    super(
      opts.message,
      opts.cause === undefined ? undefined : { cause: opts.cause },
    );
    this.name = "ARCPError";
    this.code = opts.code;
    this.retryable = opts.retryable ?? isRetryableByDefault(opts.code);
    this.details = Object.freeze({ ...opts.details });
  }

  /** Serialize to the wire `ErrorPayload` shape (§12). */
  public toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(Object.keys(this.details).length > 0
        ? { details: { ...this.details } }
        : {}),
    };
  }

  /** Re-hydrate an {@link ARCPError} from a wire payload. */
  public static fromPayload(payload: ErrorPayload): ARCPError {
    return new ARCPError({
      code: payload.code,
      message: payload.message,
      ...(payload.retryable === undefined
        ? {}
        : { retryable: payload.retryable }),
      ...(payload.details === undefined ? {} : { details: payload.details }),
    });
  }
}

/** §12 `UNAUTHENTICATED`. Missing or invalid credentials. */
export class UnauthenticatedError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "UNAUTHENTICATED", message });
    this.name = "UnauthenticatedError";
  }
}

/** §12 `PERMISSION_DENIED`. Operation rejected by lease enforcement. */
export class PermissionDeniedError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "PERMISSION_DENIED", message });
    this.name = "PermissionDeniedError";
  }
}

/** §12 `LEASE_SUBSET_VIOLATION`. Delegation request expanded beyond parent lease. */
export class LeaseSubsetViolationError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "LEASE_SUBSET_VIOLATION", message });
    this.name = "LeaseSubsetViolationError";
  }
}

/** §12 `INVALID_REQUEST`. Malformed envelope or payload schema violation. */
export class InvalidRequestError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "INVALID_REQUEST", message });
    this.name = "InvalidRequestError";
  }
}

/** §12 `JOB_NOT_FOUND`. Referenced `job_id` does not exist in this session. */
export class JobNotFoundError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "JOB_NOT_FOUND", message });
    this.name = "JobNotFoundError";
  }
}

/** §12 `DUPLICATE_KEY`. `idempotency_key` reuse with conflicting parameters. */
export class DuplicateKeyError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "DUPLICATE_KEY", message });
    this.name = "DuplicateKeyError";
  }
}

/** §12 `AGENT_NOT_AVAILABLE`. Requested `agent` is not registered. */
export class AgentNotAvailableError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "AGENT_NOT_AVAILABLE", message });
    this.name = "AgentNotAvailableError";
  }
}

/** §12 `TIMEOUT`. Job exceeded `max_runtime_sec` or other deadline. */
export class TimeoutError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "TIMEOUT", message });
    this.name = "TimeoutError";
  }
}

/** §12 `RESUME_WINDOW_EXPIRED`. Resume attempted after the buffer window closed. */
export class ResumeWindowExpiredError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "RESUME_WINDOW_EXPIRED", message });
    this.name = "ResumeWindowExpiredError";
  }
}

/** §12 `CANCELLED`. Operation cancelled by caller, runtime, or policy. */
export class CancelledError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "CANCELLED", message });
    this.name = "CancelledError";
  }
}

/** §12 `HEARTBEAT_LOST`. Runtime detected client disconnection without close. */
export class HeartbeatLostError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "HEARTBEAT_LOST", message });
    this.name = "HeartbeatLostError";
  }
}

/** §12 `INTERNAL_ERROR`. Unrecoverable runtime fault. Always retryable. */
export class InternalError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, code: "INTERNAL_ERROR", message });
    this.name = "InternalError";
  }
}

/**
 * v1.1 §12 `LEASE_EXPIRED`. The lease's `expires_at` was reached during
 * execution. Always non-retryable — naive retry will fail identically.
 */
export class LeaseExpiredError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, retryable: false, code: "LEASE_EXPIRED", message });
    this.name = "LeaseExpiredError";
  }
}

/**
 * v1.1 §12 `BUDGET_EXHAUSTED`. A `cost.budget` counter reached zero or below.
 * Always non-retryable — naive retry will fail identically.
 */
export class BudgetExhaustedError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({ ...opts, retryable: false, code: "BUDGET_EXHAUSTED", message });
    this.name = "BudgetExhaustedError";
  }
}

/**
 * v1.1 §12 `AGENT_VERSION_NOT_AVAILABLE`. The agent name resolved but the
 * requested version is not registered. Always non-retryable.
 */
export class AgentVersionNotAvailableError extends ARCPError {
  constructor(
    message: string,
    opts: Omit<ARCPErrorOptions, "message" | "code"> = {},
  ) {
    super({
      ...opts,
      retryable: false,
      code: "AGENT_VERSION_NOT_AVAILABLE",
      message,
    });
    this.name = "AgentVersionNotAvailableError";
  }
}

/**
 * Discriminated union of every typed error thrown by this SDK to consumers.
 *
 * All members extend {@link ARCPError} and carry a canonical {@link ErrorCode}
 * on `code`. Narrow with `instanceof` against a specific subclass, or branch
 * on `code` for a switch:
 *
 * @example
 * ```ts
 * try {
 *   await client.submit(...);
 * } catch (err) {
 *   if (err instanceof TimeoutError) { ... }
 *   else if (err instanceof PermissionDeniedError) { ... }
 *   else { throw err; }
 * }
 * ```
 */
export type SdkError =
  | AgentNotAvailableError
  | AgentVersionNotAvailableError
  | BudgetExhaustedError
  | CancelledError
  | DuplicateKeyError
  | HeartbeatLostError
  | InternalError
  | InvalidRequestError
  | JobNotFoundError
  | LeaseExpiredError
  | LeaseSubsetViolationError
  | PermissionDeniedError
  | ResumeWindowExpiredError
  | TimeoutError
  | UnauthenticatedError;
