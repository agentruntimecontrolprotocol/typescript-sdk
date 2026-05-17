import type { EventSeq, JobId } from "@arcp/core";
import { TaggedUnauthenticated } from "@arcp/core";
import type { BaseEnvelope } from "@arcp/core/envelope";
import { UnauthenticatedError } from "@arcp/core/errors";
import type { JobErrorPayload } from "@arcp/core/messages";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeSessionContextEffect,
  type SessionContextLike,
  SessionContextService,
  sessionContextLayer,
} from "../src/session-effect.js";

interface FakeSession extends SessionContextLike {
  readonly sent: BaseEnvelope[];
  readonly emitted: { jobId: JobId; payload: JobErrorPayload }[];
  acks: number[];
  acceptedFlag: boolean;
  closedFlag: boolean;
}

function makeFake(
  opts: { accepted?: boolean; closed?: boolean } = {},
): FakeSession {
  const sent: BaseEnvelope[] = [];
  const emitted: { jobId: JobId; payload: JobErrorPayload }[] = [];
  const acks: number[] = [];
  let seq = 0;
  const fake: FakeSession = {
    sent,
    emitted,
    acks,
    acceptedFlag: opts.accepted ?? true,
    closedFlag: opts.closed ?? false,
    state: {
      requireAccepted() {
        if (!fake.acceptedFlag) {
          throw new UnauthenticatedError("not accepted");
        }
      },
    },
    transport: {
      get closed() {
        return fake.closedFlag;
      },
    },
    negotiatedFeatures: ["ack", "heartbeat"],
    get latestEventSeq() {
      return seq as EventSeq;
    },
    nextEventSeq() {
      seq += 1;
      return seq;
    },
    recordAck(s) {
      acks.push(s);
    },
    async send(env) {
      sent.push(env);
    },
    async emitJobError(jobId, payload) {
      emitted.push({ jobId, payload });
    },
  };
  return fake;
}

describe("SessionContextService (Effect)", () => {
  it("nextEventSeq advances and latestEventSeq mirrors", async () => {
    const fake = makeFake();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionContextService;
        const a = yield* svc.nextEventSeq;
        const b = yield* svc.nextEventSeq;
        const latest = yield* svc.latestEventSeq;
        return { a, b, latest };
      }).pipe(Effect.provide(sessionContextLayer(fake))),
    );
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
    expect(result.latest).toBe(2);
  });

  it("requireAccepted gate fails with TaggedUnauthenticated when not accepted", async () => {
    const fake = makeFake({ accepted: false });
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* SessionContextService;
        yield* svc.requireAccepted;
      }).pipe(Effect.provide(sessionContextLayer(fake))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(TaggedUnauthenticated);
      }
    }
  });

  it("requireAccepted succeeds when accepted", async () => {
    const fake = makeFake({ accepted: true });
    const ok = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionContextService;
        yield* svc.requireAccepted;
        return "ok" as const;
      }).pipe(Effect.provide(sessionContextLayer(fake))),
    );
    expect(ok).toBe("ok");
  });

  it("send forwards to underlying session", async () => {
    const fake = makeFake();
    const env: BaseEnvelope = {
      id: "msg_test",
      type: "session.welcome",
      payload: { runtime: { name: "x", version: "y", fingerprint: "z" } },
    } as unknown as BaseEnvelope;
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionContextService;
        yield* svc.send(env);
      }).pipe(Effect.provide(sessionContextLayer(fake))),
    );
    expect(fake.sent.length).toBe(1);
    expect(fake.sent[0]).toBe(env);
  });

  it("recordAck delegates", async () => {
    const fake = makeFake();
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionContextService;
        yield* svc.recordAck(7);
        yield* svc.recordAck(42);
      }).pipe(Effect.provide(sessionContextLayer(fake))),
    );
    expect(fake.acks).toEqual([7, 42]);
  });

  it("isClosed reflects transport state", async () => {
    const fake = makeFake({ closed: true });
    const closed = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionContextService;
        return yield* svc.isClosed;
      }).pipe(Effect.provide(sessionContextLayer(fake))),
    );
    expect(closed).toBe(true);
  });

  it("makeSessionContextEffect can be used inline without the layer", async () => {
    const fake = makeFake();
    const ops = makeSessionContextEffect(fake);
    const seq = await Effect.runPromise(ops.nextEventSeq);
    expect(seq).toBe(1);
  });
});
