import type Database from "better-sqlite3";

/** Filter for `EventLog.query`. AND-ed across keys, OR-ed within arrays. */
export interface EventLogFilter {
  session_id?: string;
  job_id?: string;
  trace_id?: string;
  types?: readonly string[];
  /** Inclusive lower bound on `id` (lexical, ULID-ordered). */
  after_id?: string;
  /** Lower bound on `event_seq` (strict). When set, replaces `after_id` semantics. */
  after_event_seq?: number;
  /** Maximum rows to return. Default 1000. */
  limit?: number;
}

export interface EventLogOptions {
  /** Path to a SQLite file, or `":memory:"` for ephemeral storage. Default `":memory:"`. */
  path?: string;
  /**
   * Optional pre-built `better-sqlite3` Database instance. Tests inject this
   * to share a database across helpers; production code passes only `path`.
   */
  db?: InstanceType<typeof Database>;
  /**
   * Read-only mode. When true, opening calls into SQLite with the readonly
   * flag and write methods reject with INVALID_REQUEST.
   */
  readonly?: boolean;
}
