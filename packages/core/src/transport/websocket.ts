import { WebSocket, WebSocketServer } from "ws";

import { InvalidRequestError } from "../errors.js";

import type {
  FrameHandler,
  SendableFrame,
  Transport,
  WireFrame,
} from "./base.js";

/**
 * WebSocket transport (§22 mandatory).
 *
 * Wraps a single `ws` connection. Used on either side. Frames are JSON,
 * one per WS message; binary sidecar frames are out of scope for v0.1.
 *
 * @see PLAN.md §6 transport layer.
 */
export class WebSocketTransport implements Transport {
  private handler: FrameHandler | null = null;
  private closeHandler: ((err?: Error) => void) | null = null;
  private isClosed = false;
  /** Serializes inbound handler invocations to preserve ordering (see Transport contract). */
  private inboundChain: Promise<void> = Promise.resolve();

  public constructor(private readonly socket: WebSocket) {
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        // v0.1 does not support binary sidecar frames.
        return;
      }
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Array.isArray(data)
              ? Buffer.concat(data).toString("utf8")
              : Buffer.from(data).toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
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
    });
    socket.on("close", () => {
      this.fireClose();
    });
    socket.on("error", (err) => {
      this.fireClose(err);
    });
  }

  public get closed(): boolean {
    return this.isClosed || this.socket.readyState === WebSocket.CLOSED;
  }

  public async send(frame: SendableFrame): Promise<void> {
    if (this.closed)
      throw new InvalidRequestError("WebSocketTransport is closed");
    if (this.socket.readyState !== WebSocket.OPEN) {
      // Wait until the socket opens; happens on freshly-created clients.
      await new Promise<void>((resolve, reject) => {
        const onOpen = (): void => {
          this.socket.off("error", onError);
          resolve();
        };
        const onError = (err: Error): void => {
          this.socket.off("open", onOpen);
          reject(err);
        };
        this.socket.once("open", onOpen);
        this.socket.once("error", onError);
      });
    }
    return new Promise<void>((resolve, reject) => {
      this.socket.send(JSON.stringify(frame), (err) => {
        if (err === undefined) resolve();
        else reject(err);
      });
    });
  }

  public onFrame(handler: FrameHandler): void {
    if (this.handler !== null) {
      throw new InvalidRequestError(
        "WebSocketTransport already has a frame handler",
      );
    }
    this.handler = handler;
  }

  public onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

  // Transport.close is async-by-contract; the WS path finishes synchronously
  // (the close-handler fires via the 'close' event handler upstream).
  // eslint-disable-next-line @typescript-eslint/require-await
  public async close(_reason?: string): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
    this.fireClose();
  }

  private fireClose(err?: Error): void {
    if (this.closeHandler !== null) {
      const handler = this.closeHandler;
      this.closeHandler = null;
      handler(err);
    }
  }

  /** Connect a client transport to the given URL. Resolves once the WS is OPEN. */
  public static async connect(url: string): Promise<WebSocketTransport> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        socket.off("error", onError);
        resolve();
      };
      const onError = (err: Error): void => {
        socket.off("open", onOpen);
        reject(err);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });
    return new WebSocketTransport(socket);
  }
}

export interface WebSocketServerHandle {
  /** Resolved port the server bound to. */
  readonly port: number;
  /** Resolved URL clients should use to connect. */
  readonly url: string;
  /** Stop accepting new connections and close all open ones. */
  close(): Promise<void>;
}

/**
 * Bind a WebSocket server on `host`/`port`. For each incoming connection,
 * the `onTransport` callback is invoked with a {@link WebSocketTransport}.
 * The runtime is expected to call `ARCPServer.accept(transport)` on it.
 */
export async function startWebSocketServer(args: {
  host?: string;
  port?: number;
  onTransport: (transport: WebSocketTransport) => void;
}): Promise<WebSocketServerHandle> {
  const host = args.host ?? "127.0.0.1";
  const port = args.port ?? 0; // 0 = ephemeral

  const wss = new WebSocketServer({ host, port });
  wss.on("connection", (socket) => {
    args.onTransport(new WebSocketTransport(socket));
  });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  const addr = wss.address();
  if (addr === null || typeof addr === "string") {
    await new Promise<void>((resolve, reject) => {
      wss.close((err) => {
        if (err === undefined) resolve();
        else reject(err);
      });
    });
    throw new Error("WebSocketServer address unavailable");
  }

  return {
    port: addr.port,
    url: `ws://${host}:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close((err) => {
          if (err === undefined) {
            resolve();
          } else {
            reject(err);
          }
        });
      }),
  };
}
