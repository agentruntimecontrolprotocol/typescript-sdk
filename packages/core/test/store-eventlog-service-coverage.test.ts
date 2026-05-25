import Database from "better-sqlite3";
import { Chunk, Effect, Exit, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  buildEnvelope,
  EventLog,
  EventLogService,
  eventLogLayer,
  type SessionId,
} from "@agentruntimecontrolprotocol/core";

const SESSION = "sess_test" as SessionId;

function envFor(seq: number, sessionId: SessionId = SESSION) {
  return buildEnvelope({
    id: `msg_${String(seq).padStart(5, "0")}`,
    type: "job.event",
    payload: { n: seq },
    optional: { session_id: sessionId, event_seq: seq },
  });
}

describe("EventLogService coverage", () => {
  it("fails fast when the default service is used without a layer", async () => {
    const program = Effect.gen(function* () {
      const log = yield* EventLogService;
      yield* log.append(envFor(1));
    }).pipe(Effect.provide(EventLogService.Default));

    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("binds a read-only service layer on top of a pre-created schema", async () => {
    const db = new Database(":memory:");
    const legacy = new EventLog({ db });
    await legacy.append(envFor(1));
    await legacy.append(envFor(2));

    const program = Effect.gen(function* () {
      const log = yield* EventLogService;
      const count = yield* log.count(SESSION);
      const first = yield* log.getById(SESSION, "msg_00001");
      const replay = yield* Stream.runCollect(log.replay(SESSION, 0));
      return { count, first, replay: Chunk.toReadonlyArray(replay) } as const;
    }).pipe(Effect.provide(eventLogLayer(db, { readonly: true })));

    const out = await Effect.runPromise(program);
    expect(out.count).toBe(2);
    expect(out.first?.event_seq).toBe(1);
    expect(out.replay.map((e) => e.event_seq)).toEqual([1, 2]);
    await legacy.close();
  });
});
