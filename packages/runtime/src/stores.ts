import { randomBytes } from "node:crypto";

import {
  type JobId,
  type ResumeToken,
  TaggedResumeWindowExpired,
} from "@arcp/core";
import { Effect, SynchronizedRef } from "effect";

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
  return `rt_${randomBytes(32).toString("hex")}`;
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

// ============================================================================
// Effect-shaped twin — `IdempotencyStoreService`
// ============================================================================

/**
 * Compose the storage key the legacy `IdempotencyStore` uses. Matches the
 * `${principal}::${idempotency_key}` shape produced by `job-runner.ts` so the
 * two store impls remain interchangeable while migration is in flight.
 */
export function idempotencyKey(principal: string, key: string): string {
  return `${principal}::${key}`;
}

type IdempotencyMap = ReadonlyMap<string, IdempotencyEntry>;
type IdempotencyRef = SynchronizedRef.SynchronizedRef<IdempotencyMap>;

function withEntry(
  map: IdempotencyMap,
  key: string,
  entry: IdempotencyEntry,
): IdempotencyMap {
  const next = new Map(map);
  next.set(key, entry);
  return next;
}

function sweepMap<V extends { expiresAt: number }>(
  map: ReadonlyMap<string, V>,
  now: number,
): ReadonlyMap<string, V> {
  let mutated: Map<string, V> | null = null;
  for (const [k, v] of map.entries()) {
    if (v.expiresAt <= now) {
      mutated ??= new Map(map);
      mutated.delete(k);
    }
  }
  return mutated ?? map;
}

function makeIdempotencyOps(ref: IdempotencyRef) {
  return {
    get: (
      principal: string,
      key: string,
    ): Effect.Effect<IdempotencyEntry | undefined> =>
      SynchronizedRef.get(ref).pipe(
        Effect.map((m) => m.get(idempotencyKey(principal, key))),
      ),
    set: (
      principal: string,
      key: string,
      entry: IdempotencyEntry,
    ): Effect.Effect<void> =>
      SynchronizedRef.update(ref, (m) =>
        withEntry(m, idempotencyKey(principal, key), entry),
      ),
    checkAndStore: (
      principal: string,
      key: string,
      entry: IdempotencyEntry,
    ): Effect.Effect<IdempotencyEntry> =>
      SynchronizedRef.modify(
        ref,
        (m): readonly [IdempotencyEntry, IdempotencyMap] => {
          const k = idempotencyKey(principal, key);
          const existing = m.get(k);
          if (existing !== undefined && existing.expiresAt > Date.now()) {
            return [existing, m];
          }
          return [entry, withEntry(m, k, entry)];
        },
      ),
    sweep: (now: number = Date.now()): Effect.Effect<void> =>
      SynchronizedRef.update(ref, (m) => sweepMap(m, now)),
    snapshot: SynchronizedRef.get(ref).pipe(
      Effect.map((m) => new Map(m) as ReadonlyMap<string, IdempotencyEntry>),
    ),
  } as const;
}

/**
 * Effect-shaped twin of {@link IdempotencyStore}. Backs the
 * `(principal, idempotency_key) → IdempotencyEntry` map with a
 * {@link SynchronizedRef} so concurrent fibers can race a `checkAndStore` for
 * the same key and all observe the same canonical entry — closing the race
 * documented in #26. Key composition follows {@link idempotencyKey}.
 *
 * The legacy {@link IdempotencyStore} class is preserved during migration; the
 * service is a behavioral twin, not a strict wrapper.
 */
export class IdempotencyStoreService extends Effect.Service<IdempotencyStoreService>()(
  "arcp/IdempotencyStoreService",
  {
    effect: Effect.gen(function* () {
      const ref = yield* SynchronizedRef.make<IdempotencyMap>(new Map());
      return makeIdempotencyOps(ref);
    }),
  },
) {}

// ============================================================================
// Effect-shaped twin — `ResumeStoreService`
// ============================================================================

type ResumeMap = ReadonlyMap<string, ResumeRecord>;
type ResumeRef = SynchronizedRef.SynchronizedRef<ResumeMap>;

export type ResumeStoreFailure = TaggedResumeWindowExpired;

function withResume(
  map: ResumeMap,
  sessionId: string,
  record: ResumeRecord,
): ResumeMap {
  const next = new Map(map);
  next.set(sessionId, record);
  return next;
}

function withoutResume(map: ResumeMap, sessionId: string): ResumeMap {
  if (!map.has(sessionId)) return map;
  const next = new Map(map);
  next.delete(sessionId);
  return next;
}

type TakeOutcome =
  | { readonly kind: "hit"; readonly record: ResumeRecord }
  | { readonly kind: "missing" }
  | { readonly kind: "expired" };

function takeResumeOutcome(
  ref: ResumeRef,
  sessionId: string,
  now: number,
): Effect.Effect<TakeOutcome> {
  return SynchronizedRef.modify(
    ref,
    (map): readonly [TakeOutcome, ResumeMap] => {
      const existing = map.get(sessionId);
      if (existing === undefined) {
        return [{ kind: "missing" }, map];
      }
      if (existing.expiresAt < now) {
        return [{ kind: "expired" }, withoutResume(map, sessionId)];
      }
      return [{ kind: "hit", record: existing }, withoutResume(map, sessionId)];
    },
  );
}

function takeResume(
  ref: ResumeRef,
  sessionId: string,
  now: number,
): Effect.Effect<ResumeRecord, ResumeStoreFailure> {
  return takeResumeOutcome(ref, sessionId, now).pipe(
    Effect.flatMap((outcome) => {
      if (outcome.kind === "hit") return Effect.succeed(outcome.record);
      const message =
        outcome.kind === "missing"
          ? `No resume record for session "${sessionId}"`
          : `Resume window has expired for session "${sessionId}"`;
      return Effect.fail(new TaggedResumeWindowExpired({ message }));
    }),
  );
}

function makeResumeOps(ref: ResumeRef) {
  return {
    get: (sessionId: string): Effect.Effect<ResumeRecord | undefined> =>
      SynchronizedRef.get(ref).pipe(Effect.map((m) => m.get(sessionId))),
    store: (sessionId: string, record: ResumeRecord): Effect.Effect<void> =>
      SynchronizedRef.update(ref, (m) => withResume(m, sessionId, record)),
    consume: (
      sessionId: string,
      now: number = Date.now(),
    ): Effect.Effect<ResumeRecord, ResumeStoreFailure> =>
      takeResume(ref, sessionId, now),
    delete: (sessionId: string): Effect.Effect<void> =>
      SynchronizedRef.update(ref, (m) => withoutResume(m, sessionId)),
    sweep: (now: number = Date.now()): Effect.Effect<void> =>
      SynchronizedRef.update(ref, (m) => sweepMap(m, now)),
    snapshot: SynchronizedRef.get(ref).pipe(
      Effect.map((m) => new Map(m) as ReadonlyMap<string, ResumeRecord>),
    ),
  } as const;
}

/**
 * Effect-shaped twin of {@link ResumeStore}. Backs the
 * `session_id → ResumeRecord` map with a {@link SynchronizedRef} so concurrent
 * fibers can `store`, `consume`, and `sweep` without trampling each other.
 *
 * The legacy {@link ResumeStore} class is preserved during migration; the
 * service is a behavioral twin, not a strict wrapper. {@link newResumeToken}
 * is intentionally left as a free function because it is pure randomness — it
 * does not touch service state.
 */
export class ResumeStoreService extends Effect.Service<ResumeStoreService>()(
  "arcp/ResumeStoreService",
  {
    effect: Effect.gen(function* () {
      const ref = yield* SynchronizedRef.make<ResumeMap>(new Map());
      return makeResumeOps(ref);
    }),
  },
) {}
