import { describe, expect, it } from "vitest";

import {
  classifyUnknownType,
  CORE_MESSAGE_TYPES,
  isCoreType,
  isVendorExtensionName,
  validateExtensionsObject,
} from "@agentruntimecontrolprotocol/core";

// Issue #75: CORE_MESSAGE_TYPES used to omit the eight v1.1 additions, so
// `isCoreType` wrongly returned false for valid v1.1 envelopes and
// `classifyUnknownType` flagged them as INVALID_REQUEST. The table below
// freezes the contract that every core envelope literal is recognized.
describe("CORE_MESSAGE_TYPES / isCoreType (issue #75)", () => {
  const V1_0_TYPES = [
    "session.hello",
    "session.welcome",
    "session.error",
    "session.bye",
    "job.submit",
    "job.accepted",
    "job.cancel",
    "job.event",
    "job.result",
    "job.error",
  ] as const;
  const V1_1_TYPES = [
    "session.ping",
    "session.pong",
    "session.ack",
    "session.list_jobs",
    "session.jobs",
    "job.subscribe",
    "job.subscribed",
    "job.unsubscribe",
  ] as const;

  it("recognizes every v1.0 type", () => {
    for (const t of V1_0_TYPES) {
      expect(CORE_MESSAGE_TYPES).toContain(t);
      expect(isCoreType(t)).toBe(true);
      // classifyUnknownType must not flag a known core type as INVALID_REQUEST.
      expect(classifyUnknownType(t).kind).not.toBe("error");
    }
  });

  it("recognizes every v1.1 addition", () => {
    for (const t of V1_1_TYPES) {
      expect(CORE_MESSAGE_TYPES).toContain(t);
      expect(isCoreType(t)).toBe(true);
      expect(classifyUnknownType(t).kind).not.toBe("error");
    }
  });
});

describe("classifyUnknownType", () => {
  it("flags unknown core-prefixed types as INVALID_REQUEST", () => {
    const result = classifyUnknownType("session.bogus");
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.code).toBe("INVALID_REQUEST");
  });

  it("drops optional vendor extensions", () => {
    const result = classifyUnknownType("x-vendor.acme.warmup", {
      extensionsObject: { optional: true },
    });
    expect(result.kind).toBe("drop");
  });

  it("rejects required vendor extensions", () => {
    const result = classifyUnknownType("x-vendor.acme.warmup");
    expect(result.kind).toBe("error");
  });
});

describe("validateExtensionsObject", () => {
  it("accepts `optional` and `x-vendor.*` keys", () => {
    expect(() => {
      validateExtensionsObject({ optional: true, "x-vendor.acme.x": {} });
    }).not.toThrow();
  });

  it("rejects invalid keys", () => {
    expect(() => {
      validateExtensionsObject({ random: 1 });
    }).toThrow();
  });
});

describe("isVendorExtensionName", () => {
  it("requires the `x-vendor.<vendor>.<name>` shape", () => {
    expect(isVendorExtensionName("x-vendor.acme.foo")).toBe(true);
    expect(isVendorExtensionName("x-vendor.acme")).toBe(false);
    expect(isVendorExtensionName("xvendor.acme.foo")).toBe(false);
  });
});
