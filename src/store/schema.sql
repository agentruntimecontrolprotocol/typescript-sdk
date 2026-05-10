-- ARCP event log schema. Append-only; primary keying enforces idempotent
-- inserts per (session_id, id) per RFC 0001 v2 §6.4 ("transport idempotency
-- key"). All indexes are scoped by session_id so replay queries (§19) and
-- subscription filters (§13) hit small per-session ranges.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS events (
  session_id      TEXT NOT NULL,
  id              TEXT NOT NULL,
  type            TEXT NOT NULL,
  timestamp       TEXT NOT NULL,
  correlation_id  TEXT,
  causation_id    TEXT,
  trace_id        TEXT,
  span_id         TEXT,
  job_id          TEXT,
  stream_id       TEXT,
  subscription_id TEXT,
  priority        TEXT,
  raw             TEXT NOT NULL,
  inserted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (session_id, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS events_correlation_idx ON events(session_id, correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_causation_idx   ON events(session_id, causation_id)   WHERE causation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_trace_idx       ON events(session_id, trace_id)       WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_job_idx         ON events(session_id, job_id)         WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_stream_idx      ON events(session_id, stream_id)      WHERE stream_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_subscription_idx ON events(session_id, subscription_id) WHERE subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_type_idx        ON events(session_id, type);
CREATE INDEX IF NOT EXISTS events_timestamp_idx   ON events(session_id, timestamp);
CREATE INDEX IF NOT EXISTS events_inserted_idx    ON events(inserted_at);
