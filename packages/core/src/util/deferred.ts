/**
 * Promise + resolve/reject pair, suitable for the pending request registry.
 *
 * Deliberately untyped on the reject side so any thrown value flows through;
 * resolve is typed by the consumer.
 */
export class Deferred<T> {
  public readonly promise: Promise<T>;
  public resolve!: (value: T | PromiseLike<T>) => void;
  public reject!: (reason: unknown) => void;
  /** True after either resolve or reject has been called. */
  public settled = false;

  public constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = (value) => {
        if (this.settled) return;
        this.settled = true;
        resolve(value);
      };
      this.reject = (reason) => {
        if (this.settled) return;
        this.settled = true;
        // Pass-through reject — callers control whether `reason` is an Error.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(reason);
      };
    });
  }
}
