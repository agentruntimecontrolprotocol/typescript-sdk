import { CancelledError, TimeoutError } from "../errors.js";
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
      throw new Error(`correlation_id "${correlationId}" already registered`);
    }
    const deferred = new Deferred<T>();
    const entry: PendingEntry<T> = { deferred, cancelTimer: null };

    if (options.deadlineMs !== undefined) {
      const timer = setTimeout(() => {
        this.expire(correlationId);
      }, options.deadlineMs);
      timer.unref();
      entry.cancelTimer = () => {
        clearTimeout(timer);
      };
    }
    if (options.signal !== undefined) {
      const sig = options.signal;
      if (sig.aborted) {
        deferred.reject(
          new CancelledError("Pending request aborted before registration"),
        );
      } else {
        sig.addEventListener(
          "abort",
          () => {
            this.cancel(correlationId, sig.reason);
          },
          { once: true },
        );
      }
    }

    this.entries.set(correlationId, entry as PendingEntry<unknown>);
    return deferred.promise;
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
    entry.deferred.resolve(value);
    return true;
  }

  public reject(correlationId: string, reason: unknown): boolean {
    const entry = this.entries.get(correlationId);
    if (entry === undefined) return false;
    this.entries.delete(correlationId);
    this.meta.delete(correlationId);
    entry.cancelTimer?.();
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
}
