/**
 * Nominal ("branded") types for opaque IDs that flow through ARCP.
 *
 * Branded types are TypeScript-only — at runtime they are still plain strings
 * (or numbers, for `EventSeq`). The wire format is unchanged. The purpose is
 * to prevent silent argument-order mistakes: a function taking `(SessionId,
 * JobId)` won't accept `(jobId, sessionId)` even though both are strings.
 *
 * The brand type mirrors zod's `z.BRAND<B>` shape so values produced by
 * `z.string().brand<"X">().parse(...)` are assignable to the corresponding
 * brand alias defined here.
 *
 * See ARCP v1.0 §5.1 (envelope `session_id`, `job_id`, `id`, `trace_id`,
 * `event_seq`) and §6.3 (`resume_token`).
 */
import type { z } from "zod";

/** Structural brand intersection compatible with `z.BRAND<B>` output. */
export type Brand<T, B extends string> = T & z.BRAND<B>;

/** Session identifier (`sess_<ulid>`); see §6.2. */
export type SessionId = Brand<string, "SessionId">;

/** Job identifier (`job_<ulid>`); see §7.1. */
export type JobId = Brand<string, "JobId">;

/** Envelope `id` (`msg_<ulid>` from runtime helpers); see §5.1. */
export type MessageId = Brand<string, "MessageId">;

/** W3C-style 32 hex-char trace identifier; see §11. */
export type TraceId = Brand<string, "TraceId">;

/** Single-use resume token issued in `session.welcome`; see §6.3. */
export type ResumeToken = Brand<string, "ResumeToken">;

/** Monotonic per-session event sequence number on `job.event`/result/error. */
export type EventSeq = Brand<number, "EventSeq">;
