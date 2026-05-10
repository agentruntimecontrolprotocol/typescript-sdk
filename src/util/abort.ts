/**
 * Combine multiple {@link AbortSignal}s into a single signal that fires when
 * any of the inputs fires. The reason of the combined signal is the reason of
 * whichever input fired first.
 *
 * The result is unref'd-friendly because it does not retain timers.
 */
export function combineSignals(...signals: readonly AbortSignal[]): AbortSignal {
  if (signals.length === 0) return new AbortController().signal;
  if (signals.length === 1) {
    const only = signals[0];
    if (only !== undefined) return only;
  }
  const ctrl = new AbortController();
  const onAbort = (signal: AbortSignal) => {
    if (!ctrl.signal.aborted) ctrl.abort(signal.reason);
  };
  for (const sig of signals) {
    if (sig.aborted) {
      ctrl.abort(sig.reason);
      return ctrl.signal;
    }
    sig.addEventListener("abort", () => onAbort(sig), { once: true });
  }
  return ctrl.signal;
}
