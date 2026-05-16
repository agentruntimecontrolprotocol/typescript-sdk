import type { Duration } from "effect";
import { Effect } from "effect";

/**
 * Cancel-safe `setTimeout` wrapper that is unref'd by default so it never
 * blocks process exit. Returns a `cancel` function.
 */
export function safeSetTimeout(
  handler: () => void,
  delayMs: number,
): () => void {
  const timer = setTimeout(handler, delayMs);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
}

/**
 * Cancel-safe `setInterval` wrapper. Same unref-by-default semantics.
 */
export function safeSetInterval(
  handler: () => void,
  periodMs: number,
): () => void {
  const timer = setInterval(handler, periodMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

/**
 * Effect-native sibling of {@link safeSetTimeout}. Sleeps for `duration`,
 * then succeeds with `void`. Fully interruptible — when the surrounding
 * fiber is interrupted, the underlying timer is cleared.
 *
 * `duration` accepts any `Duration.DurationInput` (a number of millis, a
 * tagged string like `"5 seconds"`, or a `Duration`).
 */
export function setTimeoutEffect(
  duration: Duration.DurationInput,
): Effect.Effect<void> {
  return Effect.sleep(duration);
}

/**
 * Effect-native sibling of {@link safeSetInterval}. Runs `action` repeatedly
 * with `period` between invocations. Returns an Effect that never completes
 * on its own — the caller is expected to fork it and interrupt the fiber
 * to stop the schedule. Interruption clears any pending sleep.
 *
 * The effect is wrapped in `Effect.forever`, so any failure of `action`
 * propagates and terminates the loop.
 */
export function setIntervalEffect<E, R>(
  action: Effect.Effect<unknown, E, R>,
  period: Duration.DurationInput,
): Effect.Effect<never, E, R> {
  return Effect.forever(Effect.zipRight(action, Effect.sleep(period)));
}
