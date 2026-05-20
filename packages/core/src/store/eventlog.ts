// EventLog wraps better-sqlite3 (sync) but exposes an async API so consumers
// can swap in a network-backed event log without changing call sites.
/* eslint-disable @typescript-eslint/require-await */
import Database from "better-sqlite3";
import type { Schema } from "effect";

import type { BaseEnvelope } from "../envelope.js";
import { InvalidRequestError } from "../errors.js";

import {
  buildQuery,
  type EventRow,
  ParseEnvelopeFromRow,
  projectIndexedFields,
  rowToEnvelope,
} from "./eventlog-query.js";
import { SCHEMA_SQL } from "./schema.js";
import type { EventLogFilter, EventLogOptions } from "./types.js";

type DatabaseInstance = InstanceType<typeof Database>;

// ARCP v1.1 event-log indexed columns: session_id, id, type, trace_id,
// job_id, event_seq. Replay is by (session_id, event_seq).

/**
 * Append-only SQLite event log.
 *
 * Idempotent appends per (session_id, id) per ARCP v1.1 §5.1.
 * Replay is by `event_seq` per §6.3 / §8.3.
 *
 * The underlying `better-sqlite3` driver is synchronous; this class wraps
 * each operation in a `Promise.resolve(...)` so callers do not couple to
 * the sync API.
 */
export class EventLog {
  private readonly db: DatabaseInstance;
  private readonly readOnly: boolean;
  private readonly insertStmt: ReturnType<DatabaseInstance["prepare"]>;
  private readonly readSinceIdStmt: ReturnType<DatabaseInstance["prepare"]>;
  private readonly readSinceSeqStmt: ReturnType<DatabaseInstance["prepare"]>;
  private readonly countStmt: ReturnType<DatabaseInstance["prepare"]>;
  private readonly getByIdStmt: ReturnType<DatabaseInstance["prepare"]>;
  private closed = false;

  public constructor(opts: EventLogOptions = {}) {
    this.readOnly = opts.readonly === true;
    this.db = opts.db ?? new Database(opts.path ?? ":memory:");
    this.db.exec(SCHEMA_SQL);
    this.insertStmt = this.db.prepare(
      `INSERT OR IGNORE INTO events (
        session_id, id, type, trace_id, job_id, event_seq, raw
      ) VALUES (
        @session_id, @id, @type, @trace_id, @job_id, @event_seq, @raw
      )`,
    );
    this.readSinceIdStmt = this.db.prepare(
      `SELECT * FROM events
       WHERE session_id = @session_id AND id > @after_id
       ORDER BY id ASC
       LIMIT @limit`,
    );
    this.readSinceSeqStmt = this.db.prepare(
      `SELECT * FROM events
       WHERE session_id = @session_id
         AND event_seq IS NOT NULL
         AND event_seq > @after_event_seq
       ORDER BY event_seq ASC
       LIMIT @limit`,
    );
    this.countStmt = this.db.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE session_id = COALESCE(@session_id, session_id)`,
    );
    this.getByIdStmt = this.db.prepare(
      `SELECT * FROM events WHERE session_id = @session_id AND id = @id`,
    );
  }

  /**
   * Append an envelope. Returns `true` if the row was inserted, `false` if
   * a row with the same `(session_id, id)` already existed (idempotent retry).
   */
  public async append(env: BaseEnvelope): Promise<boolean> {
    if (this.closed) throw new InvalidRequestError("EventLog is closed");
    if (this.readOnly) throw new InvalidRequestError("EventLog is read-only");
    if (env.session_id === undefined || env.session_id === "") {
      throw new InvalidRequestError(
        "EventLog.append requires session_id on the envelope",
        {
          details: { id: env.id, type: env.type },
        },
      );
    }
    const projected = projectIndexedFields(env);
    const result = this.insertStmt.run(projected);
    return result.changes === 1;
  }

  /** Append many envelopes inside a single transaction. */
  public async appendBatch(envs: readonly BaseEnvelope[]): Promise<number> {
    if (this.closed) throw new InvalidRequestError("EventLog is closed");
    if (this.readOnly) throw new InvalidRequestError("EventLog is read-only");
    let inserted = 0;
    const tx = this.db.transaction((rows: readonly BaseEnvelope[]) => {
      for (const env of rows) {
        if (env.session_id === undefined || env.session_id === "") {
          throw new InvalidRequestError(
            "appendBatch requires session_id on every envelope",
            {
              details: { id: env.id, type: env.type },
            },
          );
        }
        const result = this.insertStmt.run(projectIndexedFields(env));
        if (result.changes === 1) inserted += 1;
      }
    });
    tx(envs);
    return inserted;
  }

  /**
   * Read envelopes in (session_id, id) order. With `after_id`, returns events
   * strictly after the given id. With no `after_id`, returns all events.
   *
   * Kept for diagnostics. Canonical replay is {@link readSinceSeq}.
   */
  public async readSince(
    sessionId: string,
    afterId = "",
    limit = 1000,
  ): Promise<BaseEnvelope[]> {
    if (this.closed) throw new InvalidRequestError("EventLog is closed");
    const rows = this.readSinceIdStmt.all({
      session_id: sessionId,
      after_id: afterId,
      limit,
    }) as EventRow[];
    return rows.map(rowToEnvelope);
  }

  /**
   * Read all envelopes for a session whose `event_seq` is strictly greater
   * than `afterEventSeq`. This is the canonical resume replay query
   * (§6.3 / §8.3).
   */
  public async readSinceSeq(
    sessionId: string,
    afterEventSeq: number,
    limit = 10_000,
  ): Promise<BaseEnvelope[]> {
    if (this.closed) throw new InvalidRequestError("EventLog is closed");
    const rows = this.readSinceSeqStmt.all({
      session_id: sessionId,
      after_event_seq: afterEventSeq,
      limit,
    }) as EventRow[];
    return rows.map(rowToEnvelope);
  }

  /** Count of envelopes in a session, or all sessions if `sessionId` is undefined. */
  public async count(sessionId?: string): Promise<number> {
    if (this.closed) throw new InvalidRequestError("EventLog is closed");
    const row = this.countStmt.get({ session_id: sessionId ?? null }) as {
      n: number;
    };
    return row.n;
  }

  /** Look up a single envelope by `(session_id, id)`. Returns `null` if absent. */
  public async getById(
    sessionId: string,
    id: string,
  ): Promise<BaseEnvelope | null> {
    if (this.closed) throw new InvalidRequestError("EventLog is closed");
    const row = this.getByIdStmt.get({ session_id: sessionId, id }) as
      | EventRow
      | undefined;
    return row === undefined ? null : rowToEnvelope(row);
  }

  /**
   * Run a custom filter query. Always ordered by `event_seq` when set,
   * otherwise by `id`. Always returns at most `filter.limit` (default 1000)
   * envelopes.
   */
  public async query(filter: EventLogFilter): Promise<BaseEnvelope[]> {
    if (this.closed) throw new InvalidRequestError("EventLog is closed");
    const { sql, params } = buildQuery(filter);
    const rows = this.db.prepare(sql).all(params) as EventRow[];
    return rows.map(rowToEnvelope);
  }

  /** Close the underlying database. After this, all operations throw. */
  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

/** Helper schema (exported for tests): ensures a row's parsed envelope is valid. */
export const EventRowEnvelopeSchema = ParseEnvelopeFromRow;
export type ParsedRowEnvelope = Schema.Schema.Type<
  typeof EventRowEnvelopeSchema
>;
