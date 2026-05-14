import { monotonicFactory } from "ulid";

const factory = monotonicFactory();

/**
 * Mint a fresh monotonic ULID for use as an envelope `id`.
 *
 * Monotonic within a process under fast clock skew. Lexically sortable.
 * @see ARCP v1.0 §5.1 (`id` field semantics).
 */
export function newId(prefix?: string): string {
  const ulid = factory();
  return prefix === undefined ? ulid : `${prefix}_${ulid}`;
}

/** Mint a session id (`sess_<ulid>`). */
export function newSessionId(): string {
  return newId("sess");
}

/** Mint a job id (`job_<ulid>`). */
export function newJobId(): string {
  return newId("job");
}

/** Mint a message id (`msg_<ulid>`). */
export function newMessageId(): string {
  return newId("msg");
}

/** RFC 3339 timestamp suitable for `payload.ts` on a `job.event`. */
export function nowTimestamp(): string {
  return new Date().toISOString();
}
