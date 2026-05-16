// Loads `schema.sql` once at module init so both the legacy `EventLog` class
// and the Effect-shaped `EventLogService` apply the same DDL.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = fileURLToPath(new URL("schema.sql", import.meta.url));

/** The ARCP v1.0 event-log DDL. Idempotent (`CREATE TABLE IF NOT EXISTS`). */
export const SCHEMA_SQL: string = readFileSync(SCHEMA_PATH, "utf8");
