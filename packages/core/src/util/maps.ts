import type { Ref } from "effect";
import { Effect } from "effect";

/**
 * Look up `key` in `map`. If missing, call `make()` to produce a value, insert
 * it, and return it. The value is returned in both branches — single-pass.
 *
 * Synchronous, side-effecting on `map`. Use {@link getOrCreateEffect} for
 * `Ref<Map>` consumers in Effect-land.
 */
export function getOrCreate<K, V>(
  map: Map<K, V>,
  key: K,
  make: () => V,
): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = make();
  map.set(key, created);
  return created;
}

/**
 * Effect-native sibling of {@link getOrCreate} for `Ref<Map<K, V>>` consumers.
 *
 * Atomically reads the underlying map; if `key` is missing, runs `make` to
 * produce a value, writes it back into the ref, and returns it. If `key` is
 * already present, `make` is not executed.
 *
 * Note: the read-then-write is not a single STM transaction. Callers that
 * need strict atomicity should use `Ref.modifyEffect` directly or move to
 * `TRef`/`TMap`.
 */
export function getOrCreateEffect<K, V, E, R>(
  ref: Ref.Ref<Map<K, V>>,
  key: K,
  make: Effect.Effect<V, E, R>,
): Effect.Effect<V, E, R> {
  return Effect.gen(function* () {
    const current = yield* ref;
    const existing = current.get(key);
    if (existing !== undefined) return existing;
    const created = yield* make;
    yield* Effect.sync(() => {
      current.set(key, created);
    });
    return created;
  });
}
