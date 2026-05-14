-- ARCP v1.0 event log schema. Append-only; primary keying enforces idempotent
-- inserts per (session_id, id) per §5.1 / §7.2.
--
-- Columns mirror the v1.0 envelope: session_id, id, type, trace_id, job_id,
-- event_seq, raw.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS events (
  session_id      TEXT NOT NULL,
  id              TEXT NOT NULL,
  type            TEXT NOT NULL,
  trace_id        TEXT,
  job_id          TEXT,
  event_seq       INTEGER,
  raw             TEXT NOT NULL,
  inserted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (session_id, id)
) WITHOUT ROWID;

-- Replay path: scan by (session_id, event_seq).
CREATE INDEX IF NOT EXISTS events_seq_idx          ON events(session_id, event_seq)      WHERE event_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_trace_idx        ON events(session_id, trace_id)       WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_job_idx          ON events(session_id, job_id)         WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_type_idx         ON events(session_id, type);
CREATE INDEX IF NOT EXISTS events_inserted_idx     ON events(inserted_at);
