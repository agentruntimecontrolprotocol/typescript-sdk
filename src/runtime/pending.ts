import { CancelledError, DeadlineExceededError } from "../errors.js";
import { Deferred } from "../util/deferred.js";

/**
 * Registry of in-flight requests keyed by `correlation_id`.
 *
 * The bidirectional spine of ARCP: every command that expects a response
 * (`permission.request`, `human.input.request`, `human.choice.request`,
 * `lease.refresh`, `cancel`, etc.) registers a {@link Deferred}; the
 * response message resolves it.
 *
 * Each entry has a deadline; expiry rejects with {@link DeadlineExceededError}.
 * An optional {@link AbortSignal} can short-circuit any entry.
 */
export class PendingRegistry {
  private readonly entries = new Map<string, PendingEntry<unknown>>();

  /** Number of currently-pending entries. */
  public get size(): number {
    return this.entries.size;
  }

  /**
   * Register a new pending request. Returns a `Promise<T>` that resolves with
   * the response or rejects with a typed error.
   */
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
      entry.cancelTimer = () => clearTimeout(timer);
    }
    if (options.signal !== undefined) {
      const sig = options.signal;
      if (sig.aborted) {
        deferred.reject(new CancelledError("Pending request aborted before registration"));
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

  /** Resolve the entry for `correlationId` with `value`. No-op if missing. */
  public resolve<T>(correlationId: string, value: T): boolean {
    const entry = this.entries.get(correlationId) as PendingEntry<T> | undefined;
    if (entry === undefined) return false;
    this.entries.delete(correlationId);
    entry.cancelTimer?.();
    entry.deferred.resolve(value);
    return true;
  }

  /** Reject the entry for `correlationId` with `reason`. No-op if missing. */
  public reject(correlationId: string, reason: unknown): boolean {
    const entry = this.entries.get(correlationId);
    if (entry === undefined) return false;
    this.entries.delete(correlationId);
    entry.cancelTimer?.();
    entry.deferred.reject(reason);
    return true;
  }

  /** Cancel an entry with a {@link CancelledError}. */
  public cancel(correlationId: string, reason?: unknown): boolean {
    return this.reject(
      correlationId,
      reason instanceof Error ? reason : new CancelledError(String(reason ?? "cancelled")),
    );
  }

  /** Reject every pending entry with `reason`. Used during shutdown. */
  public rejectAll(reason: unknown): void {
    for (const id of [...this.entries.keys()]) {
      this.reject(id, reason);
    }
  }

  private expire(correlationId: string): void {
    this.reject(correlationId, new DeadlineExceededError(`Request "${correlationId}" timed out`));
  }
}

interface PendingEntry<T> {
  deferred: Deferred<T>;
  cancelTimer: (() => void) | null;
}
