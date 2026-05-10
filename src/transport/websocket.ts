import { type AddressInfo, createServer, type Server } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { InvalidArgumentError } from "../errors.js";
import type { FrameHandler, Transport, WireFrame } from "./base.js";

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

  public constructor(private readonly socket: WebSocket) {
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        // v0.1 does not support binary sidecar frames.
        return;
      }
      const text = typeof data === "string" ? data : data.toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      const frame = parsed as WireFrame;
      const h = this.handler;
      if (h !== null) void h(frame);
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

  public async send(frame: WireFrame): Promise<void> {
    if (this.closed) throw new InvalidArgumentError("WebSocketTransport is closed");
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
        if (err !== undefined && err !== null) reject(err);
        else resolve();
      });
    });
  }

  public onFrame(handler: FrameHandler): void {
    if (this.handler !== null) {
      throw new InvalidArgumentError("WebSocketTransport already has a frame handler");
    }
    this.handler = handler;
  }

  public onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

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

  // We use a regular net.Server only to obtain an ephemeral port reliably; the
  // ws module accepts the same `host`/`port` directly.
  const httpAddr = await new Promise<AddressInfo>((resolve, reject) => {
    const probe: Server = createServer();
    probe.unref();
    probe.listen(port, host, () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") {
        probe.close();
        reject(new Error("failed to bind ephemeral port"));
        return;
      }
      probe.close(() => resolve(addr));
    });
    probe.on("error", reject);
  });

  const wss = new WebSocketServer({ host, port: httpAddr.port });
  wss.on("connection", (socket) => {
    args.onTransport(new WebSocketTransport(socket));
  });

  await new Promise<void>((resolve) => {
    wss.once("listening", resolve);
  });

  return {
    port: httpAddr.port,
    url: `ws://${host}:${httpAddr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close((err) => {
          if (err !== null && err !== undefined) reject(err);
          else resolve();
        });
      }),
  };
}
