import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { z } from "zod";
import { type BaseEnvelope, BaseEnvelopeSchema } from "../envelope.js";
import { InvalidArgumentError } from "../errors.js";

type DatabaseInstance = InstanceType<typeof Database>;

const SCHEMA_PATH = fileURLToPath(new URL("./schema.sql", import.meta.url));
const SCHEMA_SQL = readFileSync(SCHEMA_PATH, "utf8");

/** Subset of envelope fields we project into indexed columns. */
interface IndexedFields {
  session_id: string;
  id: string;
  type: string;
  timestamp: string;
  correlation_id: string | null;
  causation_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  job_id: string | null;
  stream_id: string | null;
  subscription_id: string | null;
  priority: string | null;
  raw: string;
}

/** A row as returned by raw queries. */
interface EventRow extends IndexedFields {
  inserted_at: string;
}

/** Filter for {@link EventLog.query}. AND-ed across keys, OR-ed within arrays. */
export interface EventLogFilter {
  session_id?: string;
  job_id?: string;
  stream_id?: string;
  subscription_id?: string;
  trace_id?: string;
  correlation_id?: string;
  causation_id?: string;
  types?: readonly string[];
  /** Inclusive lower bound on `id` (lexical, ULID-ordered). */
  after_id?: string;
  /** Maximum rows to return. Default 1000. */
  limit?: number;
  /** Minimum priority (treated as a string set membership). */
  priorities?: readonly string[];
}

const ParseEnvelopeFromRow = BaseEnvelopeSchema.passthrough();

export interface EventLogOptions {
  /** Path to a SQLite file, or `":memory:"` for ephemeral storage. Default `":memory:"`. */
  path?: string;
  /**
   * Optional pre-built `better-sqlite3` Database instance. Tests inject this
   * to share a database across helpers; production code passes only `path`.
   */
  db?: DatabaseInstance;
  /**
   * Read-only mode. When true, opening calls into SQLite with the readonly
   * flag and write methods reject with INVALID_ARGUMENT.
   */
  readonly?: boolean;
}

/**
 * Append-only SQLite event log.
 *
 * Idempotent appends per (session_id, id) per RFC 0001 v2 §6.4.
 * Backs replay (§19), subscription backfill (§13.3), and forensic dump.
 *
 * The underlying `better-sqlite3` driver is synchronous; this class wraps
 * each operation in a `Promise.resolve(...)` so callers do not couple to
 * the sync API. There is no worker thread (overkill for v0.1 throughput).
 */
export class EventLog {
  private readonly db: DatabaseInstance;
  private readonly readOnly: boolean;
  private readonly insertStmt: ReturnType<DatabaseInstance["prepare"]>;
  private readonly readSinceStmt: ReturnType<DatabaseInstance["prepare"]>;
  private readonly countStmt: ReturnType<DatabaseInstance["prepare"]>;
  private readonly getByIdStmt: ReturnType<DatabaseInstance["prepare"]>;
  private closed = false;

  public constructor(opts: EventLogOptions = {}) {
    this.readOnly = opts.readonly === true;
    this.db = opts.db ?? new Database(opts.path ?? ":memory:");
    this.db.exec(SCHEMA_SQL);
    this.insertStmt = this.db.prepare(
      `INSERT OR IGNORE INTO events (
        session_id, id, type, timestamp, correlation_id, causation_id,
        trace_id, span_id, job_id, stream_id, subscription_id, priority, raw
      ) VALUES (
        @session_id, @id, @type, @timestamp, @correlation_id, @causation_id,
        @trace_id, @span_id, @job_id, @stream_id, @subscription_id, @priority, @raw
      )`,
    );
    this.readSinceStmt = this.db.prepare(
      `SELECT * FROM events
       WHERE session_id = @session_id AND id > @after_id
       ORDER BY id ASC
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
    if (this.closed) throw new InvalidArgumentError("EventLog is closed");
    if (this.readOnly) throw new InvalidArgumentError("EventLog is read-only");
    if (env.session_id === undefined || env.session_id === "") {
      throw new InvalidArgumentError("EventLog.append requires session_id on the envelope", {
        details: { id: env.id, type: env.type },
      });
    }
    const projected = projectIndexedFields(env);
    const result = this.insertStmt.run(projected);
    return result.changes === 1;
  }

  /** Append many envelopes inside a single transaction. */
  public async appendBatch(envs: readonly BaseEnvelope[]): Promise<number> {
    if (this.closed) throw new InvalidArgumentError("EventLog is closed");
    if (this.readOnly) throw new InvalidArgumentError("EventLog is read-only");
    let inserted = 0;
    const tx = this.db.transaction((rows: readonly BaseEnvelope[]) => {
      for (const env of rows) {
        if (env.session_id === undefined || env.session_id === "") {
          throw new InvalidArgumentError("appendBatch requires session_id on every envelope", {
            details: { id: env.id, type: env.type },
          });
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
   */
  public async readSince(
    sessionId: string,
    afterId: string = "",
    limit = 1000,
  ): Promise<BaseEnvelope[]> {
    if (this.closed) throw new InvalidArgumentError("EventLog is closed");
    const rows = this.readSinceStmt.all({
      session_id: sessionId,
      after_id: afterId,
      limit,
    }) as EventRow[];
    return rows.map(rowToEnvelope);
  }

  /** Count of envelopes in a session, or all sessions if `sessionId` is undefined. */
  public async count(sessionId?: string): Promise<number> {
    if (this.closed) throw new InvalidArgumentError("EventLog is closed");
    const row = this.countStmt.get({ session_id: sessionId ?? null }) as { n: number };
    return row.n;
  }

  /** Look up a single envelope by `(session_id, id)`. Returns `null` if absent. */
  public async getById(sessionId: string, id: string): Promise<BaseEnvelope | null> {
    if (this.closed) throw new InvalidArgumentError("EventLog is closed");
    const row = this.getByIdStmt.get({ session_id: sessionId, id }) as EventRow | undefined;
    return row === undefined ? null : rowToEnvelope(row);
  }

  /**
   * Run a custom filter query. Used by subscriptions and inspection tooling.
   * Always ordered by `id` ascending. Always returns at most `filter.limit`
   * (default 1000) envelopes.
   */
  public async query(filter: EventLogFilter): Promise<BaseEnvelope[]> {
    if (this.closed) throw new InvalidArgumentError("EventLog is closed");
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

function projectIndexedFields(env: BaseEnvelope): IndexedFields {
  if (env.session_id === undefined) {
    throw new InvalidArgumentError("envelope is missing session_id");
  }
  return {
    session_id: env.session_id,
    id: env.id,
    type: env.type,
    timestamp: env.timestamp,
    correlation_id: env.correlation_id ?? null,
    causation_id: env.causation_id ?? null,
    trace_id: env.trace_id ?? null,
    span_id: env.span_id ?? null,
    job_id: env.job_id ?? null,
    stream_id: env.stream_id ?? null,
    subscription_id: env.subscription_id ?? null,
    priority: env.priority ?? null,
    raw: JSON.stringify(env),
  };
}

function rowToEnvelope(row: EventRow): BaseEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.raw);
  } catch (cause) {
    throw new InvalidArgumentError("EventLog row contains invalid JSON", {
      details: { id: row.id, session_id: row.session_id },
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    });
  }
  const result = ParseEnvelopeFromRow.safeParse(parsed);
  if (!result.success) {
    throw new InvalidArgumentError("EventLog row failed envelope schema", {
      details: { id: row.id, session_id: row.session_id, issues: result.error.issues },
    });
  }
  return result.data;
}

interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

function buildQuery(filter: EventLogFilter): BuiltQuery {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.session_id !== undefined) {
    where.push("session_id = @session_id");
    params["session_id"] = filter.session_id;
  }
  if (filter.job_id !== undefined) {
    where.push("job_id = @job_id");
    params["job_id"] = filter.job_id;
  }
  if (filter.stream_id !== undefined) {
    where.push("stream_id = @stream_id");
    params["stream_id"] = filter.stream_id;
  }
  if (filter.subscription_id !== undefined) {
    where.push("subscription_id = @subscription_id");
    params["subscription_id"] = filter.subscription_id;
  }
  if (filter.trace_id !== undefined) {
    where.push("trace_id = @trace_id");
    params["trace_id"] = filter.trace_id;
  }
  if (filter.correlation_id !== undefined) {
    where.push("correlation_id = @correlation_id");
    params["correlation_id"] = filter.correlation_id;
  }
  if (filter.causation_id !== undefined) {
    where.push("causation_id = @causation_id");
    params["causation_id"] = filter.causation_id;
  }
  if (filter.types !== undefined && filter.types.length > 0) {
    const placeholders = filter.types.map((_, i) => `@type_${i}`).join(",");
    where.push(`type IN (${placeholders})`);
    filter.types.forEach((t, i) => {
      params[`type_${i}`] = t;
    });
  }
  if (filter.priorities !== undefined && filter.priorities.length > 0) {
    const placeholders = filter.priorities.map((_, i) => `@prio_${i}`).join(",");
    where.push(`priority IN (${placeholders})`);
    filter.priorities.forEach((p, i) => {
      params[`prio_${i}`] = p;
    });
  }
  if (filter.after_id !== undefined && filter.after_id !== "") {
    where.push("id > @after_id");
    params["after_id"] = filter.after_id;
  }
  const sql = `
    SELECT * FROM events
    ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
    ORDER BY id ASC
    LIMIT @limit
  `;
  params["limit"] = filter.limit ?? 1000;
  return { sql, params };
}

/** Helper schema (exported for tests): ensures a row's parsed envelope is valid. */
export const EventRowEnvelopeSchema = ParseEnvelopeFromRow;
export type ParsedRowEnvelope = z.infer<typeof EventRowEnvelopeSchema>;
