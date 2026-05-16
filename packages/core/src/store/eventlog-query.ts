import { type BaseEnvelope, BaseEnvelopeSchema } from "../envelope.js";
import { InvalidRequestError } from "../errors.js";

import type { EventLogFilter } from "./types.js";

/** Subset of envelope fields projected into the event-log indexed columns. */
export interface IndexedFields {
  session_id: string;
  id: string;
  type: string;
  trace_id: string | null;
  job_id: string | null;
  event_seq: number | null;
  raw: string;
}

/** A row as returned by raw queries. */
export interface EventRow extends IndexedFields {
  inserted_at: string;
}

/** Parameterized query as built from an `EventLogFilter`. */
export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

export const ParseEnvelopeFromRow = BaseEnvelopeSchema.passthrough();

export function projectIndexedFields(env: BaseEnvelope): IndexedFields {
  if (env.session_id === undefined) {
    throw new InvalidRequestError("envelope is missing session_id");
  }
  return {
    session_id: env.session_id,
    id: env.id,
    type: env.type,
    trace_id: env.trace_id ?? null,
    job_id: env.job_id ?? null,
    event_seq: env.event_seq ?? null,
    raw: JSON.stringify(env),
  };
}

export function rowToEnvelope(row: EventRow): BaseEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.raw);
  } catch (error) {
    throw new InvalidRequestError("EventLog row contains invalid JSON", {
      details: { id: row.id, session_id: row.session_id },
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
  const result = ParseEnvelopeFromRow.safeParse(parsed);
  if (!result.success) {
    throw new InvalidRequestError("EventLog row failed envelope schema", {
      details: {
        id: row.id,
        session_id: row.session_id,
        issues: result.error.issues,
      },
    });
  }
  return result.data;
}

const EQUALITY_COLUMNS: readonly (keyof EventLogFilter)[] = [
  "session_id",
  "job_id",
  "trace_id",
];

export function buildQuery(filter: EventLogFilter): BuiltQuery {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  pushEqualityClauses(filter, where, params);
  pushTypesClause(filter, where, params);
  pushPaginationClause(filter, where, params);
  const orderBy =
    filter.after_event_seq === undefined ? "id ASC" : "event_seq ASC";
  const sql = `
    SELECT * FROM events
    ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
    ORDER BY ${orderBy}
    LIMIT @limit
  `;
  params["limit"] = filter.limit ?? 1000;
  return { sql, params };
}

function pushEqualityClauses(
  filter: EventLogFilter,
  where: string[],
  params: Record<string, unknown>,
): void {
  for (const col of EQUALITY_COLUMNS) {
    const v = filter[col];
    if (v !== undefined) {
      where.push(`${col} = @${col}`);
      params[col] = v;
    }
  }
}

function pushTypesClause(
  filter: EventLogFilter,
  where: string[],
  params: Record<string, unknown>,
): void {
  if (filter.types === undefined || filter.types.length === 0) return;
  const placeholders = filter.types.map((_, i) => `@type_${i}`).join(",");
  where.push(`type IN (${placeholders})`);
  for (const [i, t] of filter.types.entries()) {
    params[`type_${i}`] = t;
  }
}

function pushPaginationClause(
  filter: EventLogFilter,
  where: string[],
  params: Record<string, unknown>,
): void {
  if (filter.after_event_seq !== undefined) {
    where.push("event_seq > @after_event_seq");
    params["after_event_seq"] = filter.after_event_seq;
    return;
  }
  if (filter.after_id !== undefined && filter.after_id !== "") {
    where.push("id > @after_id");
    params["after_id"] = filter.after_id;
  }
}
