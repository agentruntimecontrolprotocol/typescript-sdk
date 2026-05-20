import { Effect } from "effect";
import { monotonicFactory } from "ulid";

import type { JobId, MessageId, SessionId } from "../brands.js";

const factory = monotonicFactory();

/**
 * Mint a fresh monotonic ULID for use as an envelope `id`.
 *
 * Monotonic within a process under fast clock skew. Lexically sortable.
 * @see ARCP v1.1 §5.1 (`id` field semantics).
 */
export function newId(prefix?: string): string {
  const ulid = factory();
  return prefix === undefined ? ulid : `${prefix}_${ulid}`;
}

/** Mint a session id (`sess_<ulid>`). */
export function newSessionId(): SessionId {
  return newId("sess");
}

/** Mint a job id (`job_<ulid>`). */
export function newJobId(): JobId {
  return newId("job");
}

/** Mint a message id (`msg_<ulid>`). */
export function newMessageId(): MessageId {
  return newId("msg");
}

/** RFC 3339 timestamp suitable for `payload.ts` on a `job.event`. */
export function nowTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Effect-native id generator. Wraps `monotonicFactory()` from `ulid` in a
 * service so downstream Effect code can depend on `IdGen` and swap in a
 * deterministic generator under test via `IdGen.Default` replacement.
 *
 * The service exposes:
 *   - `next: Effect<string>` — mint a bare ULID.
 *   - `prefixed(prefix): Effect<string>` — mint `${prefix}_<ulid>`.
 *
 * The factory is constructed once per `Layer` instantiation (see
 * `IdGen.Default`), preserving monotonicity within a single layer scope.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const id = yield* (yield* IdGen).next
 *   return id
 * }).pipe(Effect.provide(IdGen.Default))
 * ```
 */
export class IdGen extends Effect.Service<IdGen>()("arcp/IdGen", {
  effect: Effect.sync(() => {
    const mint = monotonicFactory();
    return {
      next: Effect.sync(() => mint()),
      prefixed: (prefix: string): Effect.Effect<string> =>
        Effect.sync(() => `${prefix}_${mint()}`),
    } as const;
  }),
}) {}
