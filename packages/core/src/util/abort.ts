import { Effect } from "effect";

/**
 * Combine multiple {@link AbortSignal}s into a single signal that fires when
 * any of the inputs fires. The reason of the combined signal is the reason of
 * whichever input fired first.
 *
 * Uses the platform `AbortSignal.any` primitive (Node 22+) so listeners are not
 * retained on the caller's behalf.
 */
export function combineSignals(
  ...signals: readonly AbortSignal[]
): AbortSignal {
  if (signals.length === 0) return new AbortController().signal;
  if (signals.length === 1) {
    const only = signals[0];
    if (only !== undefined) return only;
    return new AbortController().signal;
  }
  return AbortSignal.any([...signals]);
}

/**
 * Build an Effect that interrupts itself as soon as `signal` aborts.
 *
 * Useful for bridging a callback-style cancellation source into an Effect
 * pipeline: race or zip this against a long-running operation and the whole
 * fiber unwinds when the caller's signal fires. If `signal` is already
 * aborted, the returned Effect interrupts immediately.
 *
 * The listener is registered with `{ once: true }` and removed on Effect
 * cleanup, so no references are retained on the caller's `AbortController`.
 */
export function signalToInterruption(
  signal: AbortSignal,
): Effect.Effect<never> {
  return Effect.async<never>((resume, fiberSignal) => {
    if (signal.aborted) {
      resume(Effect.interrupt);
      return;
    }
    const onAbort = (): void => {
      resume(Effect.interrupt);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    fiberSignal.addEventListener(
      "abort",
      () => {
        signal.removeEventListener("abort", onAbort);
      },
      { once: true },
    );
  });
}
