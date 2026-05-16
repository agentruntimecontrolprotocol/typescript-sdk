import { TaggedInvalidRequest, TaggedPermissionDenied } from "@arcp/core";
import type { Lease } from "@arcp/core/messages";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  assertLeaseSubsetEffect,
  validateLeaseConstraintsEffect,
  validateLeaseOpEffect,
} from "../src/lease-effect.js";

const denyAll: Lease = {};
const fsReadOnly: Lease = { "fs.read": ["/a/**"] };

describe("validateLeaseOpEffect", () => {
  it("succeeds when the capability matches", async () => {
    await Effect.runPromise(
      validateLeaseOpEffect({
        lease: fsReadOnly,
        capability: "fs.read",
        target: "/a/b",
      }),
    );
  });

  it("fails with TaggedPermissionDenied when no pattern matches", async () => {
    const exit = await Effect.runPromiseExit(
      validateLeaseOpEffect({
        lease: denyAll,
        capability: "fs.read",
        target: "/a/b",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(TaggedPermissionDenied);
      }
    }
  });
});

describe("assertLeaseSubsetEffect", () => {
  it("succeeds for an obvious subset", async () => {
    await Effect.runPromise(
      assertLeaseSubsetEffect(fsReadOnly, { "fs.read": ["/a/**"] }),
    );
  });

  it("fails when child outscope parent", async () => {
    const exit = await Effect.runPromiseExit(
      assertLeaseSubsetEffect(
        { "fs.read": ["/b/**"] },
        { "fs.read": ["/a/**"] },
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("validateLeaseConstraintsEffect", () => {
  it("returns null when constraints undefined", async () => {
    const result = await Effect.runPromise(
      validateLeaseConstraintsEffect(undefined),
    );
    expect(result).toBeNull();
  });

  it("returns parsed ms when expires_at is future-UTC", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = await Effect.runPromise(
      validateLeaseConstraintsEffect({ expires_at: future }),
    );
    expect(result).toBe(Date.parse(future));
  });

  it("fails with TaggedInvalidRequest when expires_at is in the past", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const exit = await Effect.runPromiseExit(
      validateLeaseConstraintsEffect({ expires_at: past }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(TaggedInvalidRequest);
      }
    }
  });
});
