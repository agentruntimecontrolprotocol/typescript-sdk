import Database from "better-sqlite3";
import { Chunk, Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  type BaseEnvelope,
  buildEnvelope,
  EventLog,
  EventLogService,
  eventLogLayer,
  type SessionId,
} from "@agentruntimecontrolprotocol/core";

const SESSION = "sess_test" as SessionId;

function envFor(seq: number, sessionId: SessionId = SESSION): BaseEnvelope {
  return buildEnvelope({
    id: `msg_${String(seq).padStart(5, "0")}`,
    type: "job.event",
    payload: { n: seq },
    optional: {
      session_id: sessionId,
      event_seq: seq,
    },
  });
}

function withInMemoryService<A>(
  program: (
    db: InstanceType<typeof Database>,
  ) => Effect.Effect<A, never, EventLogService>,
): Promise<A> {
  const db = new Database(":memory:");
  return Effect.runPromise(program(db).pipe(Effect.provide(eventLogLayer(db))));
}

describe("EventLogService", () => {
  it("appends 100 events and replays them in seq order", async () => {
    const replayed = await withInMemoryService((_db) =>
      Effect.gen(function* () {
        const log = yield* EventLogService;
        for (let i = 1; i <= 100; i += 1) {
          yield* log.append(envFor(i));
        }
        const chunk = yield* Stream.runCollect(log.replay(SESSION, 0));
        return Chunk.toReadonlyArray(chunk);
      }),
    );
    expect(replayed).toHaveLength(100);
    const seqs = replayed.map((e) => e.event_seq);
    expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it("replay from non-zero fromSeq skips earlier rows", async () => {
    const replayed = await withInMemoryService((_db) =>
      Effect.gen(function* () {
        const log = yield* EventLogService;
        for (let i = 1; i <= 20; i += 1) {
          yield* log.append(envFor(i));
        }
        const chunk = yield* Stream.runCollect(log.replay(SESSION, 10));
        return Chunk.toReadonlyArray(chunk);
      }),
    );
    expect(replayed).toHaveLength(10);
    expect(replayed[0]?.event_seq).toBe(11);
    expect(replayed.at(-1)?.event_seq).toBe(20);
  });

  it("concurrent appends from multiple fibers preserve all events with monotonic seq", async () => {
    const replayed = await withInMemoryService((_db) =>
      Effect.gen(function* () {
        const log = yield* EventLogService;
        const seqs = Array.from({ length: 200 }, (_, i) => i + 1);
        yield* Effect.all(
          seqs.map((seq) => log.append(envFor(seq))),
          { concurrency: "unbounded" },
        );
        const chunk = yield* Stream.runCollect(log.replay(SESSION, 0));
        return Chunk.toReadonlyArray(chunk);
      }),
    );
    expect(replayed).toHaveLength(200);
    const observed = replayed.map((e) => e.event_seq);
    // Replay order is by event_seq ASC; check strictly monotonic.
    for (let i = 1; i < observed.length; i += 1) {
      const prev = observed[i - 1];
      const cur = observed[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      if (prev !== undefined && cur !== undefined) {
        expect(cur).toBeGreaterThan(prev);
      }
    }
    expect(new Set(observed).size).toBe(200);
  });

  it("legacy EventLog class still works on a separate in-memory DB", async () => {
    const log = new EventLog();
    const inserted = await log.append(envFor(1));
    expect(inserted).toBe(true);
    const dup = await log.append(envFor(1));
    expect(dup).toBe(false);
    const rows = await log.readSinceSeq(SESSION, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_seq).toBe(1);
    await log.append(envFor(2));
    expect(await log.getSeqBounds(SESSION)).toEqual({ min: 1, max: 2 });
    expect(await log.getSeqBounds("sess_empty")).toEqual({
      min: null,
      max: null,
    });
    await log.close();
  });

  // Issue #81: readonly: true must open the underlying handle in read-only
  // mode AND skip schema DDL. Previously the flag was ignored and DDL ran
  // even when the file was read-only on disk.
  it("readonly EventLog forbids append and reads existing data", async () => {
    const writer = new Database(":memory:");
    const writerLog = new EventLog({ db: writer });
    await writerLog.append(envFor(1));
    await writerLog.append(envFor(2));

    // A read-only EventLog sharing the same in-memory handle must surface
    // append() as a clean ARCP error rather than a SQLite write attempt.
    const readerLog = new EventLog({ db: writer, readonly: true });
    await expect(readerLog.append(envFor(3))).rejects.toThrow(
      /read-only|readonly/i,
    );
    const rows = await readerLog.readSinceSeq(SESSION, 0);
    expect(rows.map((e) => e.event_seq)).toEqual([1, 2]);
    await writerLog.close();
  });

  it("legacy EventLog and EventLogService share a single SQLite handle", async () => {
    const db = new Database(":memory:");
    const legacy = new EventLog({ db });
    await legacy.append(envFor(1));
    await legacy.append(envFor(2));
    const program = Effect.gen(function* () {
      const log = yield* EventLogService;
      yield* log.append(envFor(3));
      const chunk = yield* Stream.runCollect(log.replay(SESSION, 0));
      return Chunk.toReadonlyArray(chunk);
    }).pipe(Effect.provide(eventLogLayer(db)));
    const all = await Effect.runPromise(program);
    expect(all.map((e) => e.event_seq)).toEqual([1, 2, 3]);
  });

  it("query helper applies type filter through the service", async () => {
    const result = await withInMemoryService((_db) =>
      Effect.gen(function* () {
        const log = yield* EventLogService;
        yield* log.append(envFor(1));
        yield* log.append(envFor(2));
        const rows = yield* log.query({
          session_id: SESSION,
          types: ["job.event"],
          limit: 10,
        });
        return rows;
      }),
    );
    expect(result).toHaveLength(2);
  });
});
