import type { BaseEnvelope } from "../envelope.js";
import { buildEnvelope } from "../envelope.js";
import type { ARCPError } from "../errors.js";
import { FailedPreconditionError, InvalidArgumentError } from "../errors.js";
import type {
  StreamChunkPayload,
  StreamClosePayload,
  StreamKind,
  StreamOpenPayload,
} from "../messages/index.js";
import { newMessageId, newStreamId, nowTimestamp } from "../util/ulid.js";

/** Function used by a {@link StreamWriter} to emit envelopes. */
export type StreamSendFn = (env: BaseEnvelope) => Promise<void>;

/**
 * Server-side writer for an outbound ARCP stream (§11).
 *
 * - Sequence numbers are auto-incrementing per stream; ordering within
 *   `stream_id` is preserved by virtue of being awaited in send order.
 * - Backpressure is honored cooperatively: callers `await` each `write` and
 *   the writer inserts the configured backpressure delay between chunks.
 */
export class StreamWriter {
  public readonly streamId: string;
  public readonly kind: StreamKind;
  private sequence = 0;
  private backoffMs = 0;
  private closed = false;

  public constructor(
    public readonly sessionId: string,
    private readonly send: StreamSendFn,
    options: {
      kind: StreamKind;
      contentType?: string;
      encoding?: string;
      streamId?: string;
      relatedJobId?: string;
    },
  ) {
    this.streamId = options.streamId ?? newStreamId();
    this.kind = options.kind;
    void this.emitOpen(options);
  }

  /** Whether the writer has emitted `stream.close` or `stream.error`. */
  public get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Apply a backpressure hint. v0.1 implementation: convert
   * `desired_rate_per_second` into a per-chunk delay before subsequent writes.
   */
  public applyBackpressure(desiredRatePerSecond: number | undefined): void {
    if (desiredRatePerSecond === undefined || desiredRatePerSecond <= 0) {
      this.backoffMs = 0;
      return;
    }
    this.backoffMs = Math.ceil(1000 / desiredRatePerSecond);
  }

  /**
   * Send a chunk. The caller provides the kind-specific payload fields;
   * `sequence` is auto-assigned.
   */
  public async write(chunk: Omit<StreamChunkPayload, "sequence">): Promise<void> {
    if (this.closed) throw new FailedPreconditionError("Stream is closed");
    const seq = this.sequence;
    this.sequence += 1;
    if (this.backoffMs > 0) {
      await new Promise<void>((r) => {
        setTimeout(r, this.backoffMs).unref();
      });
    }
    const env = buildEnvelope({
      id: newMessageId(),
      type: "stream.chunk" as const,
      timestamp: nowTimestamp(),
      payload: { ...chunk, sequence: seq },
      optional: { session_id: this.sessionId, stream_id: this.streamId },
    });
    await this.send(env as BaseEnvelope);
  }

  /** Close the stream cleanly. Idempotent; subsequent writes throw. */
  public async close(payload: StreamClosePayload = {}): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const env = buildEnvelope({
      id: newMessageId(),
      type: "stream.close" as const,
      timestamp: nowTimestamp(),
      payload: { ...payload, total_chunks: this.sequence },
      optional: { session_id: this.sessionId, stream_id: this.streamId },
    });
    await this.send(env as BaseEnvelope);
  }

  /** Close the stream with an error. */
  public async error(err: ARCPError): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const env = buildEnvelope({
      id: newMessageId(),
      type: "stream.error" as const,
      timestamp: nowTimestamp(),
      payload: err.toPayload(),
      optional: { session_id: this.sessionId, stream_id: this.streamId },
    });
    await this.send(env as BaseEnvelope);
  }

  private async emitOpen(options: {
    kind: StreamKind;
    contentType?: string;
    encoding?: string;
    relatedJobId?: string;
  }): Promise<void> {
    const payload: StreamOpenPayload = {
      kind: options.kind,
      ...(options.contentType !== undefined ? { content_type: options.contentType } : {}),
      ...(options.encoding !== undefined ? { encoding: options.encoding } : {}),
      ...(options.relatedJobId !== undefined ? { related_job_id: options.relatedJobId } : {}),
    };
    const env = buildEnvelope({
      id: newMessageId(),
      type: "stream.open" as const,
      timestamp: nowTimestamp(),
      payload,
      optional: { session_id: this.sessionId, stream_id: this.streamId },
    });
    await this.send(env as BaseEnvelope);
  }
}

/**
 * Async-iterable inbound stream. Dispatchers feed chunks via {@link push};
 * consumers `for await` over them. Termination via {@link end} or {@link fail}.
 */
export class StreamReader implements AsyncIterableIterator<StreamChunkPayload> {
  private readonly buffer: StreamChunkPayload[] = [];
  private waiter: ((v: IteratorResult<StreamChunkPayload>) => void) | null = null;
  private closed = false;
  private failure: Error | null = null;
  private lastSequence = -1;

  public constructor(public readonly streamId: string) {}

  public push(chunk: StreamChunkPayload): void {
    if (this.closed) return;
    if (chunk.sequence !== this.lastSequence + 1) {
      this.fail(
        new InvalidArgumentError(
          `Stream "${this.streamId}" received out-of-order chunk: expected ${this.lastSequence + 1}, got ${chunk.sequence}`,
          {
            details: {
              stream_id: this.streamId,
              expected: this.lastSequence + 1,
              got: chunk.sequence,
            },
          },
        ),
      );
      return;
    }
    this.lastSequence = chunk.sequence;
    if (this.waiter !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: chunk, done: false });
      return;
    }
    this.buffer.push(chunk);
  }

  public end(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiter !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined, done: true });
    }
  }

  public fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = err;
    if (this.waiter !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined, done: true });
    }
  }

  public async next(): Promise<IteratorResult<StreamChunkPayload>> {
    if (this.failure !== null) throw this.failure;
    if (this.buffer.length > 0) {
      const value = this.buffer.shift();
      if (value !== undefined) {
        return { value, done: false };
      }
    }
    if (this.closed) {
      if (this.failure !== null) throw this.failure;
      return { value: undefined, done: true };
    }
    return new Promise<IteratorResult<StreamChunkPayload>>((resolve) => {
      this.waiter = resolve;
    });
  }

  public [Symbol.asyncIterator](): AsyncIterableIterator<StreamChunkPayload> {
    return this;
  }
}
