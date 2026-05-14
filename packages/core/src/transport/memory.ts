import { InvalidRequestError } from "../errors.js";
import type {
  FrameHandler,
  SendableFrame,
  Transport,
  WireFrame,
} from "./base.js";

/**
 * Two transports sharing a Promise-coupled queue. Used by tests to drive a
 * runtime + client without any actual I/O, and as the backing transport for
 * fixtures that exercise protocol semantics independently of the wire.
 *
 * `pairMemoryTransports()` returns `[a, b]` such that `a.send(x)` arrives at
 * `b`'s frame handler and vice-versa. Frames are delivered in FIFO order; if
 * the recipient has not yet registered an `onFrame` handler, frames are
 * buffered until one is.
 */
export class MemoryTransport implements Transport {
  private peer?: MemoryTransport;
  private handler: FrameHandler | null = null;
  private closeHandler: ((err?: Error) => void) | null = null;
  private buffer: SendableFrame[] = [];
  private isClosed = false;

  /** Connect this transport to its peer. Internal — use {@link pairMemoryTransports}. */
  public connect(peer: MemoryTransport): void {
    this.peer = peer;
  }

  public get closed(): boolean {
    return this.isClosed;
  }

  public async send(frame: SendableFrame): Promise<void> {
    if (this.isClosed)
      throw new InvalidRequestError("MemoryTransport is closed");
    const peer = this.peer;
    if (peer === undefined) {
      throw new InvalidRequestError("MemoryTransport has no peer");
    }
    await peer.deliver(frame);
  }

  public onFrame(handler: FrameHandler): void {
    if (this.handler !== null) {
      throw new InvalidRequestError(
        "MemoryTransport already has a frame handler",
      );
    }
    this.handler = handler;
    // Drain any frames that arrived before the handler was registered, in order.
    if (this.buffer.length > 0) {
      const drain = this.buffer;
      this.buffer = [];
      void drainBuffered(drain, handler);
    }
  }

  public onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

  public async close(reason?: string): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    const peer = this.peer;
    this.closeHandler?.(reason !== undefined ? new Error(reason) : undefined);
    if (peer !== undefined && !peer.isClosed) {
      await peer.close(reason);
    }
  }

  private async deliver(frame: SendableFrame): Promise<void> {
    if (this.isClosed) return;
    const handler = this.handler;
    if (handler === null) {
      this.buffer.push(frame);
      return;
    }
    await handler(frame as WireFrame);
  }
}

async function drainBuffered(
  buffered: SendableFrame[],
  handler: FrameHandler,
): Promise<void> {
  for (const frame of buffered) {
    await handler(frame as WireFrame);
  }
}

/**
 * Create a paired in-memory transport for tests. The returned tuple is
 * `[clientSide, serverSide]`; both sides start unconnected to any handler
 * but are wired to deliver frames to one another.
 */
export function pairMemoryTransports(): [MemoryTransport, MemoryTransport] {
  const a = new MemoryTransport();
  const b = new MemoryTransport();
  a.connect(b);
  b.connect(a);
  return [a, b];
}
