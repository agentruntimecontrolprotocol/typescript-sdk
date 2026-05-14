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
