import { randomBytes } from "node:crypto";

import type { JobId, ResumeToken } from "@arcp/core";

export interface IdempotencyEntry {
  jobId: JobId;
  agent: string;
  inputDigest: string;
  expiresAt: number;
}

export interface ResumeRecord {
  sessionId: string;
  resumeToken: string;
  expiresAt: number;
}

export function digest(input: unknown): string {
  return JSON.stringify(input);
}

export function newResumeToken(): ResumeToken {
  return `rt_${randomBytes(32).toString("hex")}` as ResumeToken;
}

/**
 * In-process `(principal, idempotency_key) → job` cache. Entries carry a
 * caller-computed `expiresAt`; {@link sweep} drops anything past it.
 */
export class IdempotencyStore {
  private readonly map = new Map<string, IdempotencyEntry>();

  public get(key: string): IdempotencyEntry | undefined {
    return this.map.get(key);
  }

  public set(key: string, entry: IdempotencyEntry): void {
    this.map.set(key, entry);
  }

  public sweep(now: number = Date.now()): void {
    for (const [k, v] of this.map.entries()) {
      if (v.expiresAt <= now) this.map.delete(k);
    }
  }
}

/**
 * `session_id → ResumeRecord` cache for §6.3 resume. Entries carry a
 * caller-computed `expiresAt`; {@link sweep} drops anything past it.
 */
export class ResumeStore {
  private readonly map = new Map<string, ResumeRecord>();

  public get(sessionId: string): ResumeRecord | undefined {
    return this.map.get(sessionId);
  }

  public set(sessionId: string, record: ResumeRecord): void {
    this.map.set(sessionId, record);
  }

  public delete(sessionId: string): void {
    this.map.delete(sessionId);
  }

  public sweep(now: number = Date.now()): void {
    for (const [k, v] of this.map.entries()) {
      if (v.expiresAt <= now) this.map.delete(k);
    }
  }
}
