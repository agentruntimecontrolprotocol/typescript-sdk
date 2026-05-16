// Effect.Service wrapper around the same better-sqlite3-backed event log used
// by the legacy class. `better-sqlite3` is synchronous, so every operation is
// wrapped in `Effect.sync` — never `Effect.tryPromise`. `replay` returns a
// `Stream` constructed via `Stream.fromIterableEffect` so rows arrive lazily
// from a SQLite cursor instead of being materialised into an array first.
//
// The legacy `EventLog` class in ./eventlog.ts is left in place for existing
// runtime/server.ts and CLI consumers; this module adds the Effect surface
// without rewriting either.

import type Database from "better-sqlite3";
import { Effect, Layer, Stream } from "effect";

import type { BaseEnvelope } from "../envelope.js";
import { TaggedInvalidRequest } from "../errors-tagged.js";

import {
  buildQuery,
  type EventRow,
  projectIndexedFields,
  rowToEnvelope,
} from "./eventlog-query.js";
import { SCHEMA_SQL } from "./schema.js";
import type { EventLogFilter } from "./types.js";

type DatabaseInstance = InstanceType<typeof Database>;
type Statement = ReturnType<DatabaseInstance["prepare"]>;

/** Prepared statements shared by every operation on a given DB handle. */
interface EventLogStmts {
  readonly insert: Statement;
  readonly readSinceId: Statement;
  readonly readSinceSeq: Statement;
  readonly count: Statement;
  readonly getById: Statement;
}

function prepareStmts(db: DatabaseInstance): EventLogStmts {
  return {
    insert: db.prepare(
      `INSERT OR IGNORE INTO events (
        session_id, id, type, trace_id, job_id, event_seq, raw
      ) VALUES (
        @session_id, @id, @type, @trace_id, @job_id, @event_seq, @raw
      )`,
    ),
    readSinceId: db.prepare(
      `SELECT * FROM events
       WHERE session_id = @session_id AND id > @after_id
       ORDER BY id ASC
       LIMIT @limit`,
    ),
    readSinceSeq: db.prepare(
      `SELECT * FROM events
       WHERE session_id = @session_id
         AND event_seq IS NOT NULL
         AND event_seq > @after_event_seq
       ORDER BY event_seq ASC
       LIMIT @limit`,
    ),
    count: db.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE session_id = COALESCE(@session_id, session_id)`,
    ),
    getById: db.prepare(
      `SELECT * FROM events WHERE session_id = @session_id AND id = @id`,
    ),
  };
}

function assertSessionId(env: BaseEnvelope): void {
  if (env.session_id === undefined || env.session_id === "") {
    throw new TaggedInvalidRequest({
      message: "EventLog.append requires session_id on the envelope",
      details: { id: env.id, type: env.type },
    });
  }
}

/**
 * Effect surface of the SQLite event log. See {@link eventLogLayer} for the
 * factory consumers should use to bind a service instance to a concrete
 * `better-sqlite3` handle.
 */
export interface EventLogEffect {
  /** Append a single envelope. Resolves to `true` if a new row was inserted. */
  readonly append: (env: BaseEnvelope) => Effect.Effect<boolean>;
  /** Append many envelopes inside a single SQLite transaction. */
  readonly appendBatch: (envs: readonly BaseEnvelope[]) => Effect.Effect<number>;
  /**
   * Stream envelopes for `sessionId` with `event_seq` strictly greater than
   * `afterEventSeq`. The underlying SQLite iterator is consumed lazily inside
   * the stream — rows are not buffered into an array up front.
   */
  readonly replay: (
    sessionId: string,
    afterEventSeq: number,
  ) => Stream.Stream<BaseEnvelope>;
  /** Diagnostic helper: envelopes ordered by `id` after `afterId`. */
  readonly readSince: (
    sessionId: string,
    afterId?: string,
    limit?: number,
  ) => Effect.Effect<readonly BaseEnvelope[]>;
  /** Eager replay (compatibility with legacy `readSinceSeq`). */
  readonly readSinceSeq: (
    sessionId: string,
    afterEventSeq: number,
    limit?: number,
  ) => Effect.Effect<readonly BaseEnvelope[]>;
  /** Count rows; pass `undefined` for the whole DB. */
  readonly count: (sessionId?: string) => Effect.Effect<number>;
  /** Single-row lookup by `(session_id, id)`. */
  readonly getById: (
    sessionId: string,
    id: string,
  ) => Effect.Effect<BaseEnvelope | null>;
  /** Custom filter query — same semantics as the legacy `query` method. */
  readonly query: (
    filter: EventLogFilter,
  ) => Effect.Effect<readonly BaseEnvelope[]>;
}

/**
 * Effect.Service tag for the SQLite event log. Default implementation fails
 * fast — consumers must provide a real handle via {@link eventLogLayer}.
 *
 * @example
 * ```ts
 * import Database from "better-sqlite3";
 * const program = Effect.gen(function* () {
 *   const log = yield* EventLogService;
 *   yield* log.append(env);
 *   return yield* Stream.runCollect(log.replay(sessionId, 0));
 * }).pipe(Effect.provide(eventLogLayer(new Database(":memory:"))));
 * ```
 */
const NOT_CONFIGURED = new TaggedInvalidRequest({
  message: "EventLogService requires a Database — use eventLogLayer",
});

const unconfiguredOps: EventLogEffect = {
  append: (_env) => Effect.die(NOT_CONFIGURED),
  appendBatch: (_envs) => Effect.die(NOT_CONFIGURED),
  replay: (_sessionId, _afterEventSeq) =>
    Stream.fail(NOT_CONFIGURED).pipe(Stream.orDie),
  readSince: (_sessionId, _afterId, _limit) => Effect.die(NOT_CONFIGURED),
  readSinceSeq: (_sessionId, _afterEventSeq, _limit) =>
    Effect.die(NOT_CONFIGURED),
  count: (_sessionId) => Effect.die(NOT_CONFIGURED),
  getById: (_sessionId, _id) => Effect.die(NOT_CONFIGURED),
  query: (_filter) => Effect.die(NOT_CONFIGURED),
};

export class EventLogService extends Effect.Service<EventLogService>()(
  "arcp/EventLogService",
  { succeed: unconfiguredOps },
) {}

function makeAppend(stmts: EventLogStmts) {
  return (env: BaseEnvelope): Effect.Effect<boolean> =>
    Effect.sync(() => {
      assertSessionId(env);
      const result = stmts.insert.run(projectIndexedFields(env));
      return result.changes === 1;
    });
}

function makeAppendBatch(db: DatabaseInstance, stmts: EventLogStmts) {
  const tx = db.transaction((rows: readonly BaseEnvelope[]) => {
    let inserted = 0;
    for (const env of rows) {
      assertSessionId(env);
      const result = stmts.insert.run(projectIndexedFields(env));
      if (result.changes === 1) inserted += 1;
    }
    return inserted;
  });
  return (envs: readonly BaseEnvelope[]): Effect.Effect<number> =>
    Effect.sync(() => tx(envs));
}

function makeReplay(stmts: EventLogStmts) {
  return (
    sessionId: string,
    afterEventSeq: number,
  ): Stream.Stream<BaseEnvelope> => {
    const rows = Effect.sync(
      () =>
        stmts.readSinceSeq.iterate({
          session_id: sessionId,
          after_event_seq: afterEventSeq,
          limit: Number.MAX_SAFE_INTEGER,
        }) as IterableIterator<EventRow>,
    );
    return Stream.fromIterableEffect(rows).pipe(Stream.map(rowToEnvelope));
  };
}

function makeReadSince(stmts: EventLogStmts) {
  return (
    sessionId: string,
    afterId = "",
    limit = 1000,
  ): Effect.Effect<readonly BaseEnvelope[]> =>
    Effect.sync(() => {
      const rows = stmts.readSinceId.all({
        session_id: sessionId,
        after_id: afterId,
        limit,
      }) as EventRow[];
      return rows.map(rowToEnvelope);
    });
}

function makeReadSinceSeq(stmts: EventLogStmts) {
  return (
    sessionId: string,
    afterEventSeq: number,
    limit = 10_000,
  ): Effect.Effect<readonly BaseEnvelope[]> =>
    Effect.sync(() => {
      const rows = stmts.readSinceSeq.all({
        session_id: sessionId,
        after_event_seq: afterEventSeq,
        limit,
      }) as EventRow[];
      return rows.map(rowToEnvelope);
    });
}

function makeCount(stmts: EventLogStmts) {
  return (sessionId?: string): Effect.Effect<number> =>
    Effect.sync(() => {
      const row = stmts.count.get({ session_id: sessionId ?? null }) as {
        n: number;
      };
      return row.n;
    });
}

function makeGetById(stmts: EventLogStmts) {
  return (
    sessionId: string,
    id: string,
  ): Effect.Effect<BaseEnvelope | null> =>
    Effect.sync(() => {
      const row = stmts.getById.get({ session_id: sessionId, id }) as
        | EventRow
        | undefined;
      return row === undefined ? null : rowToEnvelope(row);
    });
}

function makeQuery(db: DatabaseInstance) {
  return (filter: EventLogFilter): Effect.Effect<readonly BaseEnvelope[]> =>
    Effect.sync(() => {
      const built = buildQuery(filter);
      const rows = db.prepare(built.sql).all(built.params) as EventRow[];
      return rows.map(rowToEnvelope);
    });
}

/** Build an {@link EventLogEffect} bound to a pre-opened `better-sqlite3` handle. */
function makeEventLogOps(db: DatabaseInstance): EventLogEffect {
  db.exec(SCHEMA_SQL);
  const stmts = prepareStmts(db);
  return {
    append: makeAppend(stmts),
    appendBatch: makeAppendBatch(db, stmts),
    replay: makeReplay(stmts),
    readSince: makeReadSince(stmts),
    readSinceSeq: makeReadSinceSeq(stmts),
    count: makeCount(stmts),
    getById: makeGetById(stmts),
    query: makeQuery(db),
  };
}

/**
 * Construct a {@link EventLogService} Layer backed by an externally provided
 * `better-sqlite3` handle. Lifecycle (open/close) is the caller's concern —
 * this mirrors the legacy `new EventLog({ db })` contract and lets tests
 * share an in-memory database between the legacy class and the service.
 */
export function eventLogLayer(
  db: DatabaseInstance,
): Layer.Layer<EventLogService> {
  return Layer.succeed(
    EventLogService,
    EventLogService.make(makeEventLogOps(db)),
  );
}
