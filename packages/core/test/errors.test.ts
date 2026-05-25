import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AgentNotAvailableError,
  AgentVersionNotAvailableError,
  arcpFromTagged,
  ARCPError,
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
  TaggedAgentNotAvailable,
  TaggedAgentVersionNotAvailable,
  TaggedBudgetExhausted,
  TaggedCancelled,
  TaggedDuplicateKey,
  taggedFromARCP,
  TaggedHeartbeatLost,
  TaggedInternal,
  TaggedInvalidRequest,
  TaggedJobNotFound,
  TaggedLeaseExpired,
  TaggedLeaseSubsetViolation,
  TaggedPermissionDenied,
  TaggedResumeWindowExpired,
  type TaggedSdkError,
  TaggedTimeout,
  TaggedUnauthenticated,
  TimeoutError,
  UnauthenticatedError,
} from "@agentruntimecontrolprotocol/core";

// One row per canonical error code. Each row pairs the legacy class with its
// Effect-native `Schema.TaggedError` twin and pins the `_tag` literal the
// tagged variant uses on the wire. `Tagged` is typed as the union of the
// concrete class types so it remains both a Schema (for decode/encode) and a
// constructor.
type TaggedClass =
  | typeof TaggedAgentNotAvailable
  | typeof TaggedAgentVersionNotAvailable
  | typeof TaggedBudgetExhausted
  | typeof TaggedCancelled
  | typeof TaggedDuplicateKey
  | typeof TaggedHeartbeatLost
  | typeof TaggedInternal
  | typeof TaggedInvalidRequest
  | typeof TaggedJobNotFound
  | typeof TaggedLeaseExpired
  | typeof TaggedLeaseSubsetViolation
  | typeof TaggedPermissionDenied
  | typeof TaggedResumeWindowExpired
  | typeof TaggedTimeout
  | typeof TaggedUnauthenticated;

interface ErrorRow {
  readonly code: ErrorCode;
  readonly tag: string;
  readonly forcedRetryable?: boolean;
  readonly Legacy: new (
    message: string,
    opts?: {
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: ARCPError | Error;
    },
  ) => ARCPError;
  readonly Tagged: TaggedClass;
}

const ROWS: readonly ErrorRow[] = [
  {
    code: "UNAUTHENTICATED",
    tag: "Unauthenticated",
    Legacy: UnauthenticatedError,
    Tagged: TaggedUnauthenticated,
  },
  {
    code: "PERMISSION_DENIED",
    tag: "PermissionDenied",
    Legacy: PermissionDeniedError,
    Tagged: TaggedPermissionDenied,
  },
  {
    code: "LEASE_SUBSET_VIOLATION",
    tag: "LeaseSubsetViolation",
    Legacy: LeaseSubsetViolationError,
    Tagged: TaggedLeaseSubsetViolation,
  },
  {
    code: "INVALID_REQUEST",
    tag: "InvalidRequest",
    Legacy: InvalidRequestError,
    Tagged: TaggedInvalidRequest,
  },
  {
    code: "JOB_NOT_FOUND",
    tag: "JobNotFound",
    Legacy: JobNotFoundError,
    Tagged: TaggedJobNotFound,
  },
  {
    code: "DUPLICATE_KEY",
    tag: "DuplicateKey",
    Legacy: DuplicateKeyError,
    Tagged: TaggedDuplicateKey,
  },
  {
    code: "AGENT_NOT_AVAILABLE",
    tag: "AgentNotAvailable",
    Legacy: AgentNotAvailableError,
    Tagged: TaggedAgentNotAvailable,
  },
  {
    code: "TIMEOUT",
    tag: "Timeout",
    Legacy: TimeoutError,
    Tagged: TaggedTimeout,
  },
  {
    code: "RESUME_WINDOW_EXPIRED",
    tag: "ResumeWindowExpired",
    Legacy: ResumeWindowExpiredError,
    Tagged: TaggedResumeWindowExpired,
  },
  {
    code: "CANCELLED",
    tag: "Cancelled",
    Legacy: CancelledError,
    Tagged: TaggedCancelled,
  },
  {
    code: "HEARTBEAT_LOST",
    tag: "HeartbeatLost",
    Legacy: HeartbeatLostError,
    Tagged: TaggedHeartbeatLost,
  },
  {
    code: "INTERNAL_ERROR",
    tag: "Internal",
    forcedRetryable: true,
    Legacy: InternalError,
    Tagged: TaggedInternal,
  },
  {
    code: "LEASE_EXPIRED",
    tag: "LeaseExpired",
    forcedRetryable: false,
    Legacy: LeaseExpiredError,
    Tagged: TaggedLeaseExpired,
  },
  {
    code: "BUDGET_EXHAUSTED",
    tag: "BudgetExhausted",
    forcedRetryable: false,
    Legacy: BudgetExhaustedError,
    Tagged: TaggedBudgetExhausted,
  },
  {
    code: "AGENT_VERSION_NOT_AVAILABLE",
    tag: "AgentVersionNotAvailable",
    forcedRetryable: false,
    Legacy: AgentVersionNotAvailableError,
    Tagged: TaggedAgentVersionNotAvailable,
  },
];

describe("ARCPError legacy class hierarchy", () => {
  for (const { code, Legacy } of ROWS) {
    it(`${code}: legacy class is instanceof Error / ARCPError`, () => {
      const e = new Legacy("boom", { details: { foo: 1 } });
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(ARCPError);
      expect(e).toBeInstanceOf(Legacy);
      expect(e.code).toBe(code);
      expect(e.message).toBe("boom");
      expect(e.details).toEqual({ foo: 1 });
    });
  }
});

// Union schema over every Tagged* class, dispatching on `_tag`. Using the
// union (instead of the individual class) keeps per-row tests strongly typed
// without per-row schema casts.
const TaggedUnion = Schema.Union(
  TaggedAgentNotAvailable,
  TaggedAgentVersionNotAvailable,
  TaggedBudgetExhausted,
  TaggedCancelled,
  TaggedDuplicateKey,
  TaggedHeartbeatLost,
  TaggedInternal,
  TaggedInvalidRequest,
  TaggedJobNotFound,
  TaggedLeaseExpired,
  TaggedLeaseSubsetViolation,
  TaggedPermissionDenied,
  TaggedResumeWindowExpired,
  TaggedTimeout,
  TaggedUnauthenticated,
);

describe("Tagged* errors are Schema-decodable", () => {
  for (const { code, tag, Tagged } of ROWS) {
    it(`${code} decodes a tagged error`, async () => {
      const out = await Effect.runPromise(
        Schema.decodeUnknown(TaggedUnion)({
          _tag: tag,
          message: "boom",
          retryable: false,
          details: { hint: "x" },
        }),
      );
      expect(out._tag).toBe(tag);
      expect(out.code).toBe(code);
      expect(out.message).toBe("boom");
      expect(out.retryable).toBe(false);
      expect(out.details).toEqual({ hint: "x" });
      expect(out).toBeInstanceOf(Tagged);
      // Decoded TaggedErrors are also throwable Errors in Effect.
      expect(out).toBeInstanceOf(Error);
    });
  }
});

describe("Tagged* errors encode → decode round-trip", () => {
  for (const { code, tag, Tagged } of ROWS) {
    it(`${code} round-trips through encode/decode`, async () => {
      const original: TaggedSdkError = new Tagged({
        message: "round trip",
        retryable: true,
        details: { a: 1, b: "two" },
      });
      const encoded = await Effect.runPromise(
        Schema.encode(TaggedUnion)(original),
      );
      expect(encoded).toMatchObject({
        _tag: tag,
        message: "round trip",
        retryable: true,
        details: { a: 1, b: "two" },
      });
      const decoded = await Effect.runPromise(
        Schema.decodeUnknown(TaggedUnion)(encoded),
      );
      expect(decoded._tag).toBe(tag);
      expect(decoded.code).toBe(code);
      expect(decoded.message).toBe(original.message);
      expect(decoded.retryable).toBe(original.retryable);
      expect(decoded.details).toEqual(original.details);
    });
  }
});

describe("bridge converters: taggedFromARCP / arcpFromTagged", () => {
  for (const { code, tag, forcedRetryable, Legacy, Tagged } of ROWS) {
    it(`${code}: ARCP → Tagged preserves shape`, () => {
      const legacy = new Legacy("hello", {
        retryable: true,
        details: { k: "v" },
      });
      const tagged = taggedFromARCP(legacy);
      expect(tagged).toBeInstanceOf(Tagged);
      expect(tagged._tag).toBe(tag);
      expect(tagged.code).toBe(code);
      expect(tagged.message).toBe("hello");
      expect(tagged.retryable).toBe(forcedRetryable ?? true);
      expect(tagged.details).toEqual({ k: "v" });
    });

    it(`${code}: Tagged → ARCP preserves shape`, () => {
      const tagged = new Tagged({
        message: "hello",
        retryable: false,
        details: { k: "v" },
      });
      const legacy = arcpFromTagged(tagged);
      expect(legacy).toBeInstanceOf(Legacy);
      expect(legacy).toBeInstanceOf(ARCPError);
      expect(legacy).toBeInstanceOf(Error);
      expect(legacy.code).toBe(code);
      expect(legacy.message).toBe("hello");
      expect(legacy.retryable).toBe(forcedRetryable ?? false);
      expect(legacy.details).toEqual({ k: "v" });
    });

    it(`${code}: ARCP → Tagged → ARCP round-trip`, () => {
      const before = new Legacy("rt", {
        retryable: true,
        details: { i: 42 },
      });
      const after = arcpFromTagged(taggedFromARCP(before));
      expect(after).toBeInstanceOf(Legacy);
      expect(after.code).toBe(before.code);
      expect(after.message).toBe(before.message);
      // Pinned retryability subclasses enforce their spec value.
      expect(after.retryable).toBe(forcedRetryable ?? before.retryable);
      expect(after.details).toEqual(before.details);
    });
  }

  it("propagates cause through ARCP → Tagged → ARCP", () => {
    const root = new Error("underlying");
    const legacy = new InvalidRequestError("wrap", { cause: root });
    const tagged = taggedFromARCP(legacy);
    expect(tagged.cause).toBe(root);
    const back = arcpFromTagged(tagged);
    expect(back.cause).toBe(root);
  });

  it("omits empty details from the tagged variant", () => {
    const legacy = new TimeoutError("nope");
    const tagged = taggedFromARCP(legacy);
    expect(tagged.details).toBeUndefined();
  });
});
