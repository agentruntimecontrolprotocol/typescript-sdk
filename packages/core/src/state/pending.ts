import { Deferred as EffectDeferred, Effect, SynchronizedRef } from "effect";

import type { MessageId } from "../brands.js";
import {
  TaggedCancelled,
  TaggedInternal,
  TaggedTimeout,
} from "../errors-tagged.js";
import { CancelledError, InternalError, TimeoutError } from "../errors.js";
import { Deferred } from "../util/deferred.js";

import type { PendingMeta } from "./types.js";

/**
 * Registry of in-flight requests keyed by a correlation id (envelope `id`).
 *
 * Each entry has an optional deadline; expiry rejects with {@link TimeoutError}.
 * An optional {@link AbortSignal} can short-circuit any entry.
 */
export class PendingRegistry {
  private readonly entries = new Map<string, PendingEntry<unknown>>();
  private readonly meta = new Map<string, PendingMeta>();

  public get size(): number {
    return this.entries.size;
  }

  public register<T>(
    correlationId: string,
    options: { deadlineMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (this.entries.has(correlationId)) {
      throw new InternalError(
        `correlation_id "${correlationId}" already registered`,
      );
    }
    const deferred = new Deferred<T>();
    // Pre-aborted signal: settle the deferred and return without inserting
    // an entry — otherwise the registry leaks unreachable settled deferreds.
    if (options.signal?.aborted === true) {
      deferred.reject(
        new CancelledError("Pending request aborted before registration"),
      );
      return deferred.promise;
    }
    const entry: PendingEntry<T> = {
      deferred,
      cancelTimer: this.armDeadline(correlationId, options.deadlineMs),
      detachSignal: this.armAbort(correlationId, options.signal),
    };
    this.entries.set(correlationId, entry as PendingEntry<unknown>);
    return deferred.promise;
  }

  private armDeadline(
    correlationId: string,
    deadlineMs: number | undefined,
  ): (() => void) | null {
    if (deadlineMs === undefined) return null;
    const timer = setTimeout(() => {
      this.expire(correlationId);
    }, deadlineMs);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  }

  private armAbort(
    correlationId: string,
    signal: AbortSignal | undefined,
  ): (() => void) | null {
    if (signal === undefined) return null;
    const onAbort = (): void => {
      this.cancel(correlationId, signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => {
      signal.removeEventListener("abort", onAbort);
    };
  }

  public registerMeta(correlationId: string, meta: PendingMeta): void {
    this.meta.set(correlationId, meta);
  }

  public peekMeta(correlationId: string): PendingMeta | undefined {
    return this.meta.get(correlationId);
  }

  // The type parameter only narrows `value` for the caller; it's intentionally
  // unconstrained on the entry side.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  public resolve<T>(correlationId: string, value: T): boolean {
    const entry = this.entries.get(correlationId) as
      | PendingEntry<T>
      | undefined;
    if (entry === undefined) return false;
    this.entries.delete(correlationId);
    this.meta.delete(correlationId);
    entry.cancelTimer?.();
    entry.detachSignal?.();
    entry.deferred.resolve(value);
    return true;
  }

  public reject(correlationId: string, reason: unknown): boolean {
    const entry = this.entries.get(correlationId);
    if (entry === undefined) return false;
    this.entries.delete(correlationId);
    this.meta.delete(correlationId);
    entry.cancelTimer?.();
    entry.detachSignal?.();
    entry.deferred.reject(reason);
    return true;
  }

  public cancel(correlationId: string, reason?: unknown): boolean {
    return this.reject(
      correlationId,
      reason instanceof Error
        ? reason
        : new CancelledError(
            typeof reason === "string"
              ? reason
              : reason === undefined
                ? "cancelled"
                : JSON.stringify(reason),
          ),
    );
  }

  public rejectAll(reason: unknown): void {
    for (const id of this.entries.keys()) {
      this.reject(id, reason);
    }
  }

  private expire(correlationId: string): void {
    this.reject(
      correlationId,
      new TimeoutError(`Request "${correlationId}" timed out`),
    );
  }
}

interface PendingEntry<T> {
  deferred: Deferred<T>;
  cancelTimer: (() => void) | null;
  detachSignal: (() => void) | null;
}

// ============================================================================
// Effect-shaped twin — `PendingRegistryService`
// ============================================================================

/**
 * Failure modes surfaced on the typed-error channel for
 * {@link PendingRegistryService}. Mirrors the legacy class:
 *   - duplicate register → {@link TaggedInternal}
 *   - deadline elapsed   → {@link TaggedTimeout}
 *   - cancel/abort        → {@link TaggedCancelled}
 */
export type PendingRegistryFailure =
  | TaggedCancelled
  | TaggedInternal
  | TaggedTimeout;

interface EffectPendingEntry {
  readonly deferred: EffectDeferred.Deferred<unknown, PendingRegistryFailure>;
  readonly cancelTimer: (() => void) | null;
  readonly meta: PendingMeta | undefined;
}

interface EffectPendingState {
  readonly entries: ReadonlyMap<MessageId, EffectPendingEntry>;
}

const EMPTY_STATE: EffectPendingState = { entries: new Map() };

function withEntry(
  state: EffectPendingState,
  id: MessageId,
  entry: EffectPendingEntry,
): EffectPendingState {
  const next = new Map(state.entries);
  next.set(id, entry);
  return { entries: next };
}

function withoutEntry(
  state: EffectPendingState,
  id: MessageId,
): EffectPendingState {
  if (!state.entries.has(id)) return state;
  const next = new Map(state.entries);
  next.delete(id);
  return { entries: next };
}

/**
 * Effect-shaped twin of {@link PendingRegistry}. Backs the entry map with a
 * {@link SynchronizedRef} so concurrent fibers can `register`, `resolve`, and
 * `cancel` without trampling each other. Each registration returns an
 * `Effect` that completes when the entry is resolved, rejected, cancelled,
 * or times out — mirroring the legacy `Promise<T>` return.
 *
 * Failure modes match the legacy class:
 *   - duplicate `register` → {@link TaggedInternal}
 *   - elapsed `deadlineMs`  → {@link TaggedTimeout}
 *   - `cancel` / aborted    → {@link TaggedCancelled}
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const reg = yield* PendingRegistryService
 *   const wait = yield* reg.register<number>(id)
 *   yield* reg.resolve(id, 42)
 *   return yield* wait
 * }).pipe(Effect.provide(PendingRegistryService.Default))
 * ```
 */
export class PendingRegistryService extends Effect.Service<PendingRegistryService>()(
  "arcp/PendingRegistryService",
  {
    effect: Effect.gen(function* () {
      const ref = yield* SynchronizedRef.make<EffectPendingState>(EMPTY_STATE);
      return makePendingOps(ref);
    }),
  },
) {}

type PendingRef = SynchronizedRef.SynchronizedRef<EffectPendingState>;
type Settle = (entry: EffectPendingEntry) => Effect.Effect<boolean>;

function completeAndRemove(
  ref: PendingRef,
  id: MessageId,
  settle: Settle,
): Effect.Effect<boolean> {
  return SynchronizedRef.modifyEffect(ref, (state) => {
    const entry = state.entries.get(id);
    if (entry === undefined) {
      return Effect.succeed([false, state] as const);
    }
    entry.cancelTimer?.();
    return settle(entry).pipe(
      Effect.map((ok) => [ok, withoutEntry(state, id)] as const),
    );
  });
}

function expireEntry(ref: PendingRef, id: MessageId): Effect.Effect<void> {
  return completeAndRemove(ref, id, (entry) =>
    EffectDeferred.fail(
      entry.deferred,
      new TaggedTimeout({ message: `Request "${id}" timed out` }),
    ),
  ).pipe(Effect.asVoid);
}

function rejectAllEntries(
  ref: PendingRef,
  reason: PendingRegistryFailure,
): Effect.Effect<void> {
  return SynchronizedRef.updateEffect(ref, (state) =>
    Effect.forEach(
      [...state.entries.values()],
      (entry) => {
        entry.cancelTimer?.();
        return EffectDeferred.fail(entry.deferred, reason);
      },
      { discard: true },
    ).pipe(Effect.as(EMPTY_STATE)),
  );
}

function makePendingOps(ref: PendingRef) {
  return {
    size: SynchronizedRef.get(ref).pipe(Effect.map((s) => s.entries.size)),
    register: makeRegister(ref, (id) => expireEntry(ref, id)),
    registerMeta: (id: MessageId, meta: PendingMeta): Effect.Effect<void> =>
      SynchronizedRef.update(ref, (state) => {
        const entry = state.entries.get(id);
        if (entry === undefined) return state;
        return withEntry(state, id, { ...entry, meta });
      }),
    peekMeta: (id: MessageId): Effect.Effect<PendingMeta | undefined> =>
      SynchronizedRef.get(ref).pipe(Effect.map((s) => s.entries.get(id)?.meta)),
    resolve: (id: MessageId, value: unknown): Effect.Effect<boolean> =>
      completeAndRemove(ref, id, (entry) =>
        EffectDeferred.succeed(entry.deferred, value),
      ),
    fail: (
      id: MessageId,
      reason: PendingRegistryFailure,
    ): Effect.Effect<boolean> =>
      completeAndRemove(ref, id, (entry) =>
        EffectDeferred.fail(entry.deferred, reason),
      ),
    cancel: (id: MessageId, reason?: string): Effect.Effect<boolean> =>
      completeAndRemove(ref, id, (entry) =>
        EffectDeferred.fail(
          entry.deferred,
          new TaggedCancelled({ message: reason ?? "cancelled" }),
        ),
      ),
    rejectAll: (reason: PendingRegistryFailure): Effect.Effect<void> =>
      rejectAllEntries(ref, reason),
  } as const;
}

function makeRegister(
  ref: SynchronizedRef.SynchronizedRef<EffectPendingState>,
  expire: (id: MessageId) => Effect.Effect<void>,
) {
  return <T>(
    id: MessageId,
    options: { deadlineMs?: number } = {},
  ): Effect.Effect<Effect.Effect<T, PendingRegistryFailure>, TaggedInternal> =>
    Effect.gen(function* () {
      const deferred = yield* EffectDeferred.make<
        unknown,
        PendingRegistryFailure
      >();
      const cancelTimer = scheduleTimer(options.deadlineMs, id, expire);
      yield* SynchronizedRef.updateEffect(ref, (state) => {
        if (state.entries.has(id)) {
          cancelTimer?.();
          return Effect.fail(
            new TaggedInternal({
              message: `correlation_id "${id}" already registered`,
            }),
          );
        }
        return Effect.succeed(
          withEntry(state, id, {
            deferred,
            cancelTimer,
            meta: undefined,
          }),
        );
      });
      return EffectDeferred.await(deferred) as Effect.Effect<
        T,
        PendingRegistryFailure
      >;
    });
}

function scheduleTimer(
  deadlineMs: number | undefined,
  id: MessageId,
  expire: (id: MessageId) => Effect.Effect<void>,
): (() => void) | null {
  if (deadlineMs === undefined) return null;
  const timer = setTimeout(() => {
    void Effect.runPromise(expire(id));
  }, deadlineMs);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
}
