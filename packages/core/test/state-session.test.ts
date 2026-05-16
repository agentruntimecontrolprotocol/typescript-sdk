import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  type BearerIdentity,
  type SessionId,
  SessionState,
  SessionStateService,
  TaggedInvalidRequest,
  TaggedUnauthenticated,
} from "@arcp/core";

const ID = "sess_test" as SessionId;
const IDENTITY: BearerIdentity = { principal: "alice" };

describe("SessionStateService", () => {
  it("starts in `opening` with no id/identity/capabilities", async () => {
    const program = Effect.gen(function* () {
      const s = yield* SessionStateService;
      return yield* s.snapshot;
    }).pipe(Effect.provide(SessionStateService.Default));
    const snap = await Effect.runPromise(program);
    expect(snap).toEqual({
      id: undefined,
      phase: "opening",
      identity: undefined,
      capabilities: undefined,
    });
  });

  it("opening → accepted → closing is allowed", async () => {
    const program = Effect.gen(function* () {
      const s = yield* SessionStateService;
      yield* s.assignId(ID);
      yield* s.transition("accepted");
      yield* s.transition("closing");
      return yield* s.snapshot;
    }).pipe(Effect.provide(SessionStateService.Default));
    const snap = await Effect.runPromise(program);
    expect(snap.id).toBe(ID);
    expect(snap.phase).toBe("closing");
  });

  it("illegal transition fails with TaggedInvalidRequest", async () => {
    const program = Effect.gen(function* () {
      const s = yield* SessionStateService;
      // opening → closing is illegal (must pass through accepted)
      yield* s.transition("closing");
    }).pipe(Effect.provide(SessionStateService.Default));
    const exit = await Effect.runPromiseExit(program);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
      expect(err).toBeInstanceOf(TaggedInvalidRequest);
    }
  });

  it("re-assigning a different session_id fails", async () => {
    const program = Effect.gen(function* () {
      const s = yield* SessionStateService;
      yield* s.assignId(ID);
      yield* s.assignId("sess_other");
    }).pipe(Effect.provide(SessionStateService.Default));
    const exit = await Effect.runPromiseExit(program);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
      expect(err).toBeInstanceOf(TaggedInvalidRequest);
    }
  });

  it("re-assigning the same session_id is a no-op", async () => {
    const program = Effect.gen(function* () {
      const s = yield* SessionStateService;
      yield* s.assignId(ID);
      yield* s.assignId(ID);
      return yield* s.snapshot;
    }).pipe(Effect.provide(SessionStateService.Default));
    const snap = await Effect.runPromise(program);
    expect(snap.id).toBe(ID);
  });

  it("requireAccepted fails with TaggedUnauthenticated pre-handshake", async () => {
    const program = Effect.gen(function* () {
      const s = yield* SessionStateService;
      yield* s.requireAccepted;
    }).pipe(Effect.provide(SessionStateService.Default));
    const exit = await Effect.runPromiseExit(program);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = exit.cause._tag === "Fail" ? exit.cause.error : undefined;
      expect(err).toBeInstanceOf(TaggedUnauthenticated);
    }
  });

  it("requireAccepted succeeds once transitioned to accepted", async () => {
    const program = Effect.gen(function* () {
      const s = yield* SessionStateService;
      yield* s.transition("accepted");
      yield* s.requireAccepted;
      return yield* s.snapshot;
    }).pipe(Effect.provide(SessionStateService.Default));
    const snap = await Effect.runPromise(program);
    expect(snap.phase).toBe("accepted");
  });

  it("assignIdentity + assignCapabilities update the snapshot", async () => {
    const program = Effect.gen(function* () {
      const s = yield* SessionStateService;
      yield* s.assignIdentity(IDENTITY);
      yield* s.assignCapabilities({ encodings: ["json"] });
      return yield* s.snapshot;
    }).pipe(Effect.provide(SessionStateService.Default));
    const snap = await Effect.runPromise(program);
    expect(snap.identity).toEqual(IDENTITY);
    expect(snap.capabilities).toEqual({ encodings: ["json"] });
  });
});

describe("SessionState (legacy class) is preserved", () => {
  it("supports the original imperative API", () => {
    const s = new SessionState();
    expect(s.phase).toBe("opening");
    s.assignId(ID);
    s.assignIdentity(IDENTITY);
    s.assignCapabilities({ encodings: ["json"] });
    s.transition("accepted");
    expect(s.isAccepted).toBe(true);
    s.requireAccepted();
    expect(s.snapshot()).toEqual({
      id: ID,
      phase: "accepted",
      identity: IDENTITY,
      capabilities: { encodings: ["json"] },
    });
  });

  it("still throws InvalidRequestError on illegal transition", () => {
    const s = new SessionState();
    expect(() => {
      s.transition("closing");
    }).toThrow(/Illegal session transition/);
  });
});
