import { describe, expect, it } from "vitest";
import {
  AbortedError,
  ARCPError,
  BackpressureOverflowError,
  CancelledError,
  DataLossError,
  DeadlineExceededError,
  ERROR_CODES,
  ErrorPayloadSchema,
  FailedPreconditionError,
  HeartbeatLostError,
  InternalError,
  InvalidArgumentError,
  isErrorCode,
  isRetryableByDefault,
  LeaseExpiredError,
  LeaseRevokedError,
  NotFoundError,
  NotImplementedError,
  PermissionDeniedError,
  RATE_LIMITED,
  UnauthenticatedError,
} from "../../src/index.js";

describe("ERROR_CODES tuple", () => {
  it("includes every canonical code listed in §18.2", () => {
    const expected = new Set([
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
    ]);
    for (const code of ERROR_CODES) expect(expected.has(code)).toBe(true);
    expect(ERROR_CODES.length).toBe(expected.size);
  });

  it("RATE_LIMITED aliases RESOURCE_EXHAUSTED", () => {
    expect(RATE_LIMITED).toBe("RESOURCE_EXHAUSTED");
  });
});

describe("isErrorCode", () => {
  it("recognizes valid codes", () => {
    expect(isErrorCode("CANCELLED")).toBe(true);
    expect(isErrorCode("UNAUTHENTICATED")).toBe(true);
  });
  it("rejects unknown strings", () => {
    expect(isErrorCode("BANANA")).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(null)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });
});

describe("isRetryableByDefault", () => {
  it("marks the §18.3 retryable set as retryable", () => {
    for (const code of [
      "RESOURCE_EXHAUSTED",
      "UNAVAILABLE",
      "DEADLINE_EXCEEDED",
      "INTERNAL",
      "ABORTED",
    ] as const) {
      expect(isRetryableByDefault(code)).toBe(true);
    }
  });
  it("marks the §18.3 non-retryable set as non-retryable", () => {
    for (const code of [
      "INVALID_ARGUMENT",
      "NOT_FOUND",
      "ALREADY_EXISTS",
      "PERMISSION_DENIED",
      "FAILED_PRECONDITION",
      "UNIMPLEMENTED",
      "UNAUTHENTICATED",
      "DATA_LOSS",
    ] as const) {
      expect(isRetryableByDefault(code)).toBe(false);
    }
  });
});

describe("ARCPError", () => {
  it("captures code, message, and details", () => {
    const e = new ARCPError({
      message: "boom",
      code: "INTERNAL",
      details: { x: 1 },
    });
    expect(e.code).toBe("INTERNAL");
    expect(e.message).toBe("boom");
    expect(e.details["x"]).toBe(1);
    expect(e.retryable).toBe(true); // INTERNAL is retryable by default
  });

  it("respects an explicit retryable override", () => {
    const e = new ARCPError({ message: "x", code: "INTERNAL", retryable: false });
    expect(e.retryable).toBe(false);
  });

  it("chains causes via Error.cause", () => {
    const inner = new Error("inner");
    const outer = new ARCPError({ message: "outer", code: "INTERNAL", cause: inner });
    expect(outer.cause).toBe(inner);
  });

  it("freezes details so they cannot be mutated", () => {
    const e = new ARCPError({ message: "x", code: "INTERNAL", details: { a: 1 } });
    expect(Object.isFrozen(e.details)).toBe(true);
  });

  it("round-trips through toPayload / fromPayload", () => {
    const inner = new ARCPError({ message: "inner", code: "INVALID_ARGUMENT" });
    const outer = new ARCPError({
      message: "outer",
      code: "INTERNAL",
      details: { foo: "bar" },
      cause: inner,
      traceId: "trace_1",
    });
    const wire = outer.toPayload();
    const parsed = ErrorPayloadSchema.parse(wire);
    expect(parsed.code).toBe("INTERNAL");
    expect(parsed.cause?.code).toBe("INVALID_ARGUMENT");

    const rehydrated = ARCPError.fromPayload(parsed);
    expect(rehydrated.code).toBe("INTERNAL");
    expect(rehydrated.message).toBe("outer");
    expect(rehydrated.traceId).toBe("trace_1");
    const cause = rehydrated.cause;
    expect(cause).toBeInstanceOf(ARCPError);
    if (cause instanceof ARCPError) {
      expect(cause.code).toBe("INVALID_ARGUMENT");
    }
  });
});

describe("ARCPError subclasses", () => {
  it("each subclass pins its code", () => {
    const cases: Array<[ARCPError, string]> = [
      [new UnauthenticatedError("u"), "UNAUTHENTICATED"],
      [new PermissionDeniedError("p"), "PERMISSION_DENIED"],
      [new LeaseExpiredError("le"), "LEASE_EXPIRED"],
      [new LeaseRevokedError("lr"), "LEASE_REVOKED"],
      [new InvalidArgumentError("ia"), "INVALID_ARGUMENT"],
      [new NotFoundError("nf"), "NOT_FOUND"],
      [new FailedPreconditionError("fp"), "FAILED_PRECONDITION"],
      [new DeadlineExceededError("de"), "DEADLINE_EXCEEDED"],
      [new CancelledError("c"), "CANCELLED"],
      [new AbortedError("a"), "ABORTED"],
      [new HeartbeatLostError("h"), "HEARTBEAT_LOST"],
      [new NotImplementedError("ni"), "UNIMPLEMENTED"],
      [new InternalError("int"), "INTERNAL"],
      [new BackpressureOverflowError("bo"), "BACKPRESSURE_OVERFLOW"],
      [new DataLossError("dl"), "DATA_LOSS"],
    ];
    for (const [err, code] of cases) {
      expect(err).toBeInstanceOf(ARCPError);
      expect(err.code).toBe(code);
    }
  });

  it("LeaseExpiredError extends PermissionDeniedError", () => {
    const e = new LeaseExpiredError("expired");
    expect(e).toBeInstanceOf(PermissionDeniedError);
  });

  it("LeaseRevokedError extends PermissionDeniedError", () => {
    const e = new LeaseRevokedError("revoked");
    expect(e).toBeInstanceOf(PermissionDeniedError);
  });
});

describe("ErrorPayloadSchema", () => {
  it("requires code and message", () => {
    expect(ErrorPayloadSchema.safeParse({}).success).toBe(false);
    expect(ErrorPayloadSchema.safeParse({ code: "INTERNAL", message: "x" }).success).toBe(true);
  });

  it("rejects unknown codes", () => {
    expect(ErrorPayloadSchema.safeParse({ code: "BANANA", message: "x" }).success).toBe(false);
  });

  it("accepts a recursive cause", () => {
    const ok = ErrorPayloadSchema.safeParse({
      code: "INTERNAL",
      message: "outer",
      cause: { code: "INVALID_ARGUMENT", message: "inner" },
    });
    expect(ok.success).toBe(true);
  });
});
