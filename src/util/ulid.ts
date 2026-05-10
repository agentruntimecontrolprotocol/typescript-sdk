import { monotonicFactory } from "ulid";

const factory = monotonicFactory();

/**
 * Mint a fresh monotonic ULID for use as an envelope `id`.
 *
 * Monotonic within a process under fast clock skew. Lexically sortable.
 * @see RFC-0001-v2.md §6.1.1 (`id` field semantics).
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

/** Mint a stream id (`str_<ulid>`). */
export function newStreamId(): string {
  return newId("str");
}

/** Mint a subscription id (`sub_<ulid>`). */
export function newSubscriptionId(): string {
  return newId("sub");
}

/** Mint a message id (`msg_<ulid>`). */
export function newMessageId(): string {
  return newId("msg");
}

/** Mint a lease id (`lease_<ulid>`). */
export function newLeaseId(): string {
  return newId("lease");
}

/** Mint an artifact id (`art_<ulid>`). */
export function newArtifactId(): string {
  return newId("art");
}

/** RFC 3339 timestamp, used only for human-readable `timestamp` envelope fields. */
export function nowTimestamp(): string {
  return new Date().toISOString();
}
