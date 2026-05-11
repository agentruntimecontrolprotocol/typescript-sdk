/** SQLite replay sink. Reuses the SDK's `EventLog` schema. */
import type { BaseEnvelope } from "../../../src/index.js";

export class SQLiteSink {
  private readonly path: string;

  public constructor(opts: { path: string }) {
    this.path = opts.path;
  }

  public async open(): Promise<void> {
    // Real version: better-sqlite3 connect + executescript(EventLog schema).
    void this.path;
    throw new Error("not implemented");
  }

  public async close(): Promise<void> {
    throw new Error("not implemented");
  }

  public async handle(env: BaseEnvelope): Promise<void> {
    // Drops kind: thought to keep the replay store small.
    const p = env.payload as { kind?: string } | undefined;
    if (env.type === "stream.chunk" && p?.kind === "thought") return;
    // Real version: INSERT OR IGNORE on (id, ts, type, json).
    throw new Error("not implemented");
  }
}
