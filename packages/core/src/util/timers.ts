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
  return () => clearTimeout(timer);
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
  return () => clearInterval(timer);
}
