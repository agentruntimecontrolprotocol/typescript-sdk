import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  isReservedCapabilityName,
  isValidCapabilityName,
  LeaseConstraintsSchema,
  LeaseConstraintsZodSchema,
  LeaseSchema,
  LeaseZodSchema,
  RESERVED_CAPABILITY_NAMES,
} from "@arcp/core";

// Pin JSON shapes accepted/rejected by the migrated Effect lease schemas.
// The zod twins (`*ZodSchema`) feed `messageEnvelope()` until slice #50.

const decode =
  <A, I>(s: Schema.Schema<A, I>) =>
  (input: unknown): Promise<A> =>
    Effect.runPromise(Schema.decodeUnknown(s)(input));

describe("LeaseSchema (Effect Schema)", () => {
  it("accepts the §9.1 capability → glob map", async () => {
    const input = {
      "tool.call": ["web.search", "calc.eval"],
      "fs.read": ["/tmp/**"],
    };
    await expect(decode(LeaseSchema)(input)).resolves.toEqual(input);
  });

  it("accepts an empty lease", async () => {
    await expect(decode(LeaseSchema)({})).resolves.toEqual({});
  });

  it("drops empty capability keys (Effect Record divergence from zod)", async () => {
    // Effect's `Schema.Record` filters keys that fail the key schema; the
    // zod twin rejects them at the wire layer where it counts.
    await expect(decode(LeaseSchema)({ "": ["x"] })).resolves.toEqual({});
  });

  it("rejects empty pattern strings inside the value array", async () => {
    await expect(
      decode(LeaseSchema)({ "tool.call": [""] }),
    ).rejects.toThrow();
  });

  it("zod twin rejects empty capability keys", () => {
    expect(() => LeaseZodSchema.parse({ "": ["x"] })).toThrow();
  });

  it("zod twin accepts the docs/guides/lease.md example", () => {
    expect(() =>
      LeaseZodSchema.parse({
        "tool.call": ["web.search"],
        "fs.read": ["/tmp/**"],
      }),
    ).not.toThrow();
  });
});

describe("LeaseConstraintsSchema (Effect Schema)", () => {
  it("accepts an empty constraints object", async () => {
    await expect(decode(LeaseConstraintsSchema)({})).resolves.toEqual({});
  });

  it("accepts an ISO 8601 UTC expires_at", async () => {
    const input = { expires_at: "2025-12-31T23:59:59Z" };
    await expect(decode(LeaseConstraintsSchema)(input)).resolves.toEqual(input);
  });

  it("rejects empty expires_at", async () => {
    await expect(
      decode(LeaseConstraintsSchema)({ expires_at: "" }),
    ).rejects.toThrow();
  });

  it("zod twin accepts the same body", () => {
    expect(() =>
      LeaseConstraintsZodSchema.parse({ expires_at: "2025-12-31T23:59:59Z" }),
    ).not.toThrow();
  });
});

describe("capability name predicates", () => {
  it("isReservedCapabilityName covers the v1.0 reserved set", () => {
    for (const name of RESERVED_CAPABILITY_NAMES) {
      expect(isReservedCapabilityName(name)).toBe(true);
    }
    expect(isReservedCapabilityName("x-vendor.acme.foo")).toBe(false);
  });

  it("isValidCapabilityName accepts reserved + valid vendor names", () => {
    expect(isValidCapabilityName("tool.call")).toBe(true);
    expect(isValidCapabilityName("x-vendor.acme.foo")).toBe(true);
    expect(isValidCapabilityName("acme.foo")).toBe(false);
    expect(isValidCapabilityName("x-vendor.acme")).toBe(false);
  });
});
