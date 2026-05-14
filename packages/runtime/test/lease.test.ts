import {
  assertLeaseSubset,
  canonicalizeTarget,
  isLeaseSubset,
  matchGlob,
  validateLeaseOp,
  validateLeaseShape,
} from "@arcp/runtime";
import { describe, expect, it } from "vitest";

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
    expect(() =>
      validateLeaseOp({ "fs.read": ["/foo/**"] }, "fs.read", "/foo/bar"),
    ).not.toThrow();
  });
  it("rejects unknown capability", () => {
    expect(() =>
      validateLeaseOp({ "fs.read": ["/foo/**"] }, "fs.write", "/foo/bar"),
    ).toThrow(/PERMISSION_DENIED|Capability/);
  });
  it("canonicalizes targets before matching (path traversal)", () => {
    expect(() =>
      validateLeaseOp(
        { "fs.read": ["/safe/**"] },
        "fs.read",
        "/safe/../etc/passwd",
      ),
    ).toThrow();
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
    expect(() =>
      assertLeaseSubset(
        { "fs.read": ["/anything/**"] },
        { "fs.read": ["/foo/**"] },
      ),
    ).toThrow(/LEASE_SUBSET_VIOLATION|subset/);
  });
});

describe("validateLeaseShape", () => {
  it("permits reserved namespaces", () => {
    expect(() => validateLeaseShape({ "fs.read": ["/x"] })).not.toThrow();
  });
  it("permits x-vendor.<vendor>.<name>", () => {
    expect(() =>
      validateLeaseShape({ "x-vendor.acme.cap": ["pat"] }),
    ).not.toThrow();
  });
  it("rejects unknown bare capability", () => {
    expect(() => validateLeaseShape({ "totally.bogus": ["x"] })).toThrow(
      /INVALID_REQUEST|capability/,
    );
  });
});
