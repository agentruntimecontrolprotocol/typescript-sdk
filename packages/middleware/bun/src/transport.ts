import { InvalidRequestError } from "@arcp/core/errors";
import type {
  FrameHandler,
  SendableFrame,
  Transport,
  WireFrame,
} from "@arcp/core/transport";
import type { ServerWebSocket } from "bun";

/**
 * Transport implementation that wraps a `Bun.ServerWebSocket`.
 *
 * Mirrors the Node `WebSocketTransport` contract: one JSON-encoded frame
 * per WebSocket message, no binary sidecar frames, in-order delivery.
 *
 * Built for Bun's native server (`Bun.serve({ websocket: ... })`); a single
 * adapter instance is paired to a single `ServerWebSocket` by the
 * `onTransport` callback in `serveArcp`.
 */
export class BunWebSocketTransport implements Transport {
  private handler: FrameHandler | null = null;
  private closeHandler: ((err?: Error) => void) | null = null;
  private isClosed = false;
  /** Serializes inbound handler invocations to preserve ordering. */
  private inboundChain: Promise<void> = Promise.resolve();

  // `ServerWebSocket` is only available under Bun; reference it via the
  // global `Bun` namespace shape rather than importing a value, so this
  // module is safely-parseable under plain Node.
  public constructor(private readonly socket: ServerWebSocket<unknown>) {}

  public get closed(): boolean {
    return this.isClosed || this.socket.readyState === 3 /* CLOSED */;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async send(frame: SendableFrame): Promise<void> {
    if (this.closed)
      throw new InvalidRequestError("BunWebSocketTransport is closed");
    this.socket.send(JSON.stringify(frame));
  }

  public onFrame(handler: FrameHandler): void {
    if (this.handler !== null) {
      throw new InvalidRequestError(
        "BunWebSocketTransport already has a frame handler",
      );
    }
    this.handler = handler;
  }

  public onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async close(_reason?: string): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.socket.readyState === 1 /* OPEN */) {
      this.socket.close();
    }
    this.fireClose();
  }

  /** Called by the server's `message` handler. */
  public deliverMessage(data: string | Buffer): void {
    const text = typeof data === "string" ? data : data.toString("utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return;
    const frame = parsed as WireFrame;
    const h = this.handler;
    if (h !== null) {
      this.inboundChain = this.inboundChain
        .then(() => h(frame))
        .catch((): void => {
          /* Keep the queue alive; runtime logs protocol errors. */
        });
    }
  }

  /** Called by the server's `close` handler. */
  public deliverClose(err?: Error): void {
    this.isClosed = true;
    this.fireClose(err);
  }

  private fireClose(err?: Error): void {
    if (this.closeHandler !== null) {
      const handler = this.closeHandler;
      this.closeHandler = null;
      handler(err);
    }
  }
}
