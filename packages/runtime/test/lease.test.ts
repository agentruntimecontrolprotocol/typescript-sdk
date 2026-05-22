import { describe, expect, it } from "vitest";

import {
  assertLeaseSubset,
  canonicalizeTarget,
  isLeaseSubset,
  matchGlob,
  validateLeaseOp,
  validateLeaseShape,
} from "@agentruntimecontrolprotocol/runtime";

describe("glob matcher (§9.2)", () => {
  it("single * matches one segment", () => {
    expect(matchGlob("/foo/*", "/foo/bar")).toBe(true);
    expect(matchGlob("/foo/*", "/foo/bar/baz")).toBe(false);
  });

  it("** matches zero+ segments", () => {
    expect(matchGlob("/foo/**", "/foo")).toBe(true);
    expect(matchGlob("/foo/**", "/foo/bar")).toBe(true);
    expect(matchGlob("/foo/**", "/foo/bar/baz")).toBe(true);
    expect(matchGlob("/foo/**", "/other")).toBe(false);
  });

  it("mid-path ** is permitted", () => {
    expect(matchGlob("/foo/**/baz", "/foo/baz")).toBe(true);
    expect(matchGlob("/foo/**/baz", "/foo/x/baz")).toBe(true);
    expect(matchGlob("/foo/**/baz", "/foo/x/y/baz")).toBe(true);
  });

  it("anchored at both ends", () => {
    expect(matchGlob("/foo/*", "x/foo/bar")).toBe(false);
    expect(matchGlob("/foo/*", "/foo/bar/extra")).toBe(false);
  });
});

describe("canonicalizeTarget", () => {
  it("resolves '..'", () => {
    expect(canonicalizeTarget("/a/b/../c")).toBe("/a/c");
  });
  it("strips '.' and empty segments", () => {
    expect(canonicalizeTarget("/a/./b/")).toBe("/a/b");
  });
  it("lowercases URL scheme", () => {
    expect(canonicalizeTarget("HTTPS://example.com/x")).toBe(
      "https://example.com/x",
    );
  });
});

describe("validateLeaseOp", () => {
  it("permits a matching capability", () => {
    expect(() => {
      validateLeaseOp({
        lease: { "fs.read": ["/foo/**"] },
        capability: "fs.read",
        target: "/foo/bar",
      });
    }).not.toThrow();
  });
  it("rejects unknown capability", () => {
    expect(() => {
      validateLeaseOp({
        lease: { "fs.read": ["/foo/**"] },
        capability: "fs.write",
        target: "/foo/bar",
      });
    }).toThrow(/PERMISSION_DENIED|Capability/);
  });
  it("canonicalizes targets before matching (path traversal)", () => {
    expect(() => {
      validateLeaseOp({
        lease: { "fs.read": ["/safe/**"] },
        capability: "fs.read",
        target: "/safe/../etc/passwd",
      });
    }).toThrow();
  });
  it("permits model.use with model glob patterns", () => {
    expect(() => {
      validateLeaseOp({
        lease: { "model.use": ["gpt-4*"] },
        capability: "model.use",
        target: "gpt-4o-mini",
      });
    }).not.toThrow();
  });
  it("rejects model.use misses with PERMISSION_DENIED", () => {
    expect(() => {
      validateLeaseOp({
        lease: { "model.use": ["gpt-3.*"] },
        capability: "model.use",
        target: "claude-3-haiku",
      });
    }).toThrow(/PERMISSION_DENIED|denies/);
  });
});

describe("isLeaseSubset (§9.4)", () => {
  it("equal leases are mutual subsets", () => {
    const a = { "fs.read": ["/foo/**"] };
    expect(isLeaseSubset(a, a)).toBe(true);
  });
  it("narrower path is a subset", () => {
    const parent = { "fs.read": ["/foo/**"] };
    const child = { "fs.read": ["/foo/bar/**"] };
    expect(isLeaseSubset(child, parent)).toBe(true);
  });
  it("wider path is NOT a subset", () => {
    const parent = { "fs.read": ["/foo/bar/**"] };
    const child = { "fs.read": ["/foo/**"] };
    expect(isLeaseSubset(child, parent)).toBe(false);
  });
  it("missing parent capability is NOT a subset", () => {
    expect(isLeaseSubset({ "fs.write": ["/x"] }, { "fs.read": ["/x"] })).toBe(
      false,
    );
  });
  it("assertLeaseSubset throws LEASE_SUBSET_VIOLATION on failure", () => {
    expect(() => {
      assertLeaseSubset(
        { "fs.read": ["/anything/**"] },
        { "fs.read": ["/foo/**"] },
      );
    }).toThrow(/LEASE_SUBSET_VIOLATION|subset/);
  });
  it("treats narrower model.use globs as a subset", () => {
    expect(
      isLeaseSubset({ "model.use": ["gpt-4*"] }, { "model.use": ["**"] }),
    ).toBe(true);
  });
  it("rejects broader model.use globs than the parent", () => {
    expect(
      isLeaseSubset({ "model.use": ["**"] }, { "model.use": ["gpt-4*"] }),
    ).toBe(false);
  });
});

describe("validateLeaseShape", () => {
  it("permits reserved namespaces", () => {
    expect(() => {
      validateLeaseShape({ "fs.read": ["/x"] });
    }).not.toThrow();
  });
  it("permits model.use as a reserved namespace", () => {
    expect(() => {
      validateLeaseShape({ "model.use": ["gpt-4*"] });
    }).not.toThrow();
  });
  it("permits x-vendor.<vendor>.<name>", () => {
    expect(() => {
      validateLeaseShape({ "x-vendor.acme.cap": ["pat"] });
    }).not.toThrow();
  });
  it("rejects unknown bare capability", () => {
    expect(() => {
      validateLeaseShape({ "totally.bogus": ["x"] });
    }).toThrow(/INVALID_REQUEST|capability/);
  });
});
