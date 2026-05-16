// Effect-native error variants — `Schema.TaggedError` twins of the legacy
// `ARCPError` hierarchy in `./errors.ts`. The legacy class hierarchy stays
// for downstream consumers that rely on `instanceof Error` / `instanceof
// InvalidRequestError`; new Effect code can `Effect.fail(new TaggedXxx(...))`
// for typed-error channel ergonomics. Bridge converters in this file move
// values across the boundary.
//
// `unicorn/throw-new-error` is disabled because the rule misreads
// `Schema.TaggedError<T>()("Tag", fields)` — that's a class factory call,
// not an `Error` constructor invocation.
/* eslint-disable unicorn/throw-new-error */

import { Schema } from "effect";

import {
  AgentNotAvailableError,
  AgentVersionNotAvailableError,
  type ARCPError,
  BudgetExhaustedError,
  CancelledError,
  DuplicateKeyError,
  type ErrorCode,
  HeartbeatLostError,
  InternalError,
  InvalidRequestError,
  JobNotFoundError,
  LeaseExpiredError,
  LeaseSubsetViolationError,
  PermissionDeniedError,
  ResumeWindowExpiredError,
  TimeoutError,
  UnauthenticatedError,
} from "./errors.js";

// Common field shape mirrors `ARCPErrorOptions` minus the `code` discriminator
// (each tagged class pins its own code as a literal property).
const baseFields = {
  message: Schema.String,
  retryable: Schema.optional(Schema.Boolean),
  details: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  cause: Schema.optional(Schema.Defect),
};

/** §12 `UNAUTHENTICATED` — Effect-native variant. */
export class TaggedUnauthenticated extends Schema.TaggedError<TaggedUnauthenticated>()(
  "Unauthenticated",
  baseFields,
) {
  readonly code = "UNAUTHENTICATED" as const;
}

/** §12 `PERMISSION_DENIED` — Effect-native variant. */
export class TaggedPermissionDenied extends Schema.TaggedError<TaggedPermissionDenied>()(
  "PermissionDenied",
  baseFields,
) {
  readonly code = "PERMISSION_DENIED" as const;
}

/** §12 `LEASE_SUBSET_VIOLATION` — Effect-native variant. */
export class TaggedLeaseSubsetViolation extends Schema.TaggedError<TaggedLeaseSubsetViolation>()(
  "LeaseSubsetViolation",
  baseFields,
) {
  readonly code = "LEASE_SUBSET_VIOLATION" as const;
}

/** §12 `INVALID_REQUEST` — Effect-native variant. */
export class TaggedInvalidRequest extends Schema.TaggedError<TaggedInvalidRequest>()(
  "InvalidRequest",
  baseFields,
) {
  readonly code = "INVALID_REQUEST" as const;
}

/** §12 `JOB_NOT_FOUND` — Effect-native variant. */
export class TaggedJobNotFound extends Schema.TaggedError<TaggedJobNotFound>()(
  "JobNotFound",
  baseFields,
) {
  readonly code = "JOB_NOT_FOUND" as const;
}

/** §12 `DUPLICATE_KEY` — Effect-native variant. */
export class TaggedDuplicateKey extends Schema.TaggedError<TaggedDuplicateKey>()(
  "DuplicateKey",
  baseFields,
) {
  readonly code = "DUPLICATE_KEY" as const;
}

/** §12 `AGENT_NOT_AVAILABLE` — Effect-native variant. */
export class TaggedAgentNotAvailable extends Schema.TaggedError<TaggedAgentNotAvailable>()(
  "AgentNotAvailable",
  baseFields,
) {
  readonly code = "AGENT_NOT_AVAILABLE" as const;
}

/** §12 `TIMEOUT` — Effect-native variant. */
export class TaggedTimeout extends Schema.TaggedError<TaggedTimeout>()(
  "Timeout",
  baseFields,
) {
  readonly code = "TIMEOUT" as const;
}

/** §12 `RESUME_WINDOW_EXPIRED` — Effect-native variant. */
export class TaggedResumeWindowExpired extends Schema.TaggedError<TaggedResumeWindowExpired>()(
  "ResumeWindowExpired",
  baseFields,
) {
  readonly code = "RESUME_WINDOW_EXPIRED" as const;
}

/** §12 `CANCELLED` — Effect-native variant. */
export class TaggedCancelled extends Schema.TaggedError<TaggedCancelled>()(
  "Cancelled",
  baseFields,
) {
  readonly code = "CANCELLED" as const;
}

/** §12 `HEARTBEAT_LOST` — Effect-native variant. */
export class TaggedHeartbeatLost extends Schema.TaggedError<TaggedHeartbeatLost>()(
  "HeartbeatLost",
  baseFields,
) {
  readonly code = "HEARTBEAT_LOST" as const;
}

/** §12 `INTERNAL_ERROR` — Effect-native variant. */
export class TaggedInternal extends Schema.TaggedError<TaggedInternal>()(
  "Internal",
  baseFields,
) {
  readonly code = "INTERNAL_ERROR" as const;
}

/** v1.1 §12 `LEASE_EXPIRED` — Effect-native variant. */
export class TaggedLeaseExpired extends Schema.TaggedError<TaggedLeaseExpired>()(
  "LeaseExpired",
  baseFields,
) {
  readonly code = "LEASE_EXPIRED" as const;
}

/** v1.1 §12 `BUDGET_EXHAUSTED` — Effect-native variant. */
export class TaggedBudgetExhausted extends Schema.TaggedError<TaggedBudgetExhausted>()(
  "BudgetExhausted",
  baseFields,
) {
  readonly code = "BUDGET_EXHAUSTED" as const;
}

/** v1.1 §12 `AGENT_VERSION_NOT_AVAILABLE` — Effect-native variant. */
export class TaggedAgentVersionNotAvailable extends Schema.TaggedError<TaggedAgentVersionNotAvailable>()(
  "AgentVersionNotAvailable",
  baseFields,
) {
  readonly code = "AGENT_VERSION_NOT_AVAILABLE" as const;
}

/**
 * Transport-layer failure surfaced through Effect's typed-error channel.
 *
 * Not part of the §12 ARCP error catalog — `Transport` is the seam below
 * protocol logic, so its failures are categorically distinct from the
 * `TaggedSdkError` union. Effect-shaped transports (`memoryTransportEffect`,
 * `stdioTransportEffect`, `websocketTransportEffect`) fail their `incoming`
 * stream and `send` Effect with this error.
 *
 * `kind` is a free-form, opt-in tag for upstream pattern matching
 * (`"send"`, `"receive"`, `"parse"`, `"closed"`, etc.). `cause` carries the
 * underlying defect (typically a Node `Error` from `ws` / `readline`).
 */
export class TaggedTransportError extends Schema.TaggedError<TaggedTransportError>()(
  "TransportError",
  {
    cause: Schema.Defect,
    kind: Schema.optional(Schema.String),
  },
) {}

/**
 * Discriminated union of every Effect-native ARCP error. Mirrors `SdkError`
 * but in the typed-error channel of an `Effect`.
 */
export type TaggedSdkError =
  | TaggedAgentNotAvailable
  | TaggedAgentVersionNotAvailable
  | TaggedBudgetExhausted
  | TaggedCancelled
  | TaggedDuplicateKey
  | TaggedHeartbeatLost
  | TaggedInternal
  | TaggedInvalidRequest
  | TaggedJobNotFound
  | TaggedLeaseExpired
  | TaggedLeaseSubsetViolation
  | TaggedPermissionDenied
  | TaggedResumeWindowExpired
  | TaggedTimeout
  | TaggedUnauthenticated;

// ---------------------------------------------------------------------------
// Bridge converters
// ---------------------------------------------------------------------------

type TaggedCtor = new (opts: {
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}) => TaggedSdkError;

type LegacyCtor = new (
  message: string,
  opts?: {
    retryable?: boolean;
    details?: Record<string, unknown>;
    cause?: ARCPError | Error;
  },
) => ARCPError;

const TAGGED_BY_CODE: Readonly<Record<ErrorCode, TaggedCtor>> = {
  AGENT_NOT_AVAILABLE: TaggedAgentNotAvailable,
  AGENT_VERSION_NOT_AVAILABLE: TaggedAgentVersionNotAvailable,
  BUDGET_EXHAUSTED: TaggedBudgetExhausted,
  CANCELLED: TaggedCancelled,
  DUPLICATE_KEY: TaggedDuplicateKey,
  HEARTBEAT_LOST: TaggedHeartbeatLost,
  INTERNAL_ERROR: TaggedInternal,
  INVALID_REQUEST: TaggedInvalidRequest,
  JOB_NOT_FOUND: TaggedJobNotFound,
  LEASE_EXPIRED: TaggedLeaseExpired,
  LEASE_SUBSET_VIOLATION: TaggedLeaseSubsetViolation,
  PERMISSION_DENIED: TaggedPermissionDenied,
  RESUME_WINDOW_EXPIRED: TaggedResumeWindowExpired,
  TIMEOUT: TaggedTimeout,
  UNAUTHENTICATED: TaggedUnauthenticated,
};

const LEGACY_BY_CODE: Readonly<Record<ErrorCode, LegacyCtor>> = {
  AGENT_NOT_AVAILABLE: AgentNotAvailableError,
  AGENT_VERSION_NOT_AVAILABLE: AgentVersionNotAvailableError,
  BUDGET_EXHAUSTED: BudgetExhaustedError,
  CANCELLED: CancelledError,
  DUPLICATE_KEY: DuplicateKeyError,
  HEARTBEAT_LOST: HeartbeatLostError,
  INTERNAL_ERROR: InternalError,
  INVALID_REQUEST: InvalidRequestError,
  JOB_NOT_FOUND: JobNotFoundError,
  LEASE_EXPIRED: LeaseExpiredError,
  LEASE_SUBSET_VIOLATION: LeaseSubsetViolationError,
  PERMISSION_DENIED: PermissionDeniedError,
  RESUME_WINDOW_EXPIRED: ResumeWindowExpiredError,
  TIMEOUT: TimeoutError,
  UNAUTHENTICATED: UnauthenticatedError,
};

/**
 * Convert a legacy {@link ARCPError} (or subclass) into its Effect-native
 * `Tagged*` twin. The `retryable` field is preserved verbatim, including
 * defaults already materialized on the legacy instance.
 */
export function taggedFromARCP(err: ARCPError): TaggedSdkError {
  const Ctor = TAGGED_BY_CODE[err.code];
  return new Ctor({
    message: err.message,
    retryable: err.retryable,
    ...(Object.keys(err.details).length > 0
      ? { details: { ...err.details } }
      : {}),
    ...(err.cause === undefined ? {} : { cause: err.cause }),
  });
}

/**
 * Convert an Effect-native `Tagged*` error back into the legacy class
 * hierarchy. Useful at the boundary where Effect pipelines surface failures
 * to consumers that still pattern-match with `instanceof`.
 */
export function arcpFromTagged(t: TaggedSdkError): ARCPError {
  const Ctor = LEGACY_BY_CODE[t.code];
  const cause = t.cause;
  return new Ctor(t.message, {
    retryable: t.retryable ?? false,
    ...(t.details === undefined ? {} : { details: { ...t.details } }),
    ...(cause instanceof Error ? { cause } : {}),
  });
}
