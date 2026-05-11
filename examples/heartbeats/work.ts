/**
 * Worker work. Real version: a task graph sized per role, awaited via
 * worker_threads / a queue.
 */

export async function doWork(_payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  throw new Error("not implemented");
}
