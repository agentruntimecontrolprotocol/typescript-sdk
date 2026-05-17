import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  type BearerIdentity,
  BearerVerifierService,
  StaticBearerVerifier,
  staticBearerVerifierLayer,
  TaggedUnauthenticated,
  UnauthenticatedError,
} from "@arcp/core";

const ALICE: BearerIdentity = { principal: "alice" };

describe("staticBearerVerifierLayer (Effect surface)", () => {
  const table = new Map<string, BearerIdentity>([["tok-good", ALICE]]);
  const layer = staticBearerVerifierLayer(table);

  it("verifies a known token", async () => {
    const program = Effect.gen(function* () {
      const v = yield* BearerVerifierService;
      return yield* v.verify("tok-good");
    }).pipe(Effect.provide(layer));
    const identity = await Effect.runPromise(program);
    expect(identity).toEqual(ALICE);
  });

  it("fails with TaggedUnauthenticated for unknown tokens", async () => {
    const program = Effect.gen(function* () {
      const v = yield* BearerVerifierService;
      return yield* v.verify("tok-bad");
    }).pipe(Effect.provide(layer));
    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
      expect(err).toBeInstanceOf(TaggedUnauthenticated);
    }
  });
});

describe("BearerVerifierService default provider", () => {
  it("rejects every token until a layer is supplied", async () => {
    const program = Effect.gen(function* () {
      const v = yield* BearerVerifierService;
      return yield* v.verify("anything");
    }).pipe(Effect.provide(BearerVerifierService.Default));
    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("StaticBearerVerifier (legacy Promise surface)", () => {
  it("resolves known tokens to the identity", async () => {
    const v = new StaticBearerVerifier(new Map([["tok-good", ALICE]]));
    await expect(v.verify("tok-good")).resolves.toEqual(ALICE);
  });

  it("throws UnauthenticatedError for unknown tokens", async () => {
    const v = new StaticBearerVerifier(new Map());
    await expect(v.verify("nope")).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
