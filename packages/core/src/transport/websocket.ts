import { Effect, Stream } from "effect";
import { WebSocket, WebSocketServer } from "ws";

import { TaggedTransportError } from "../errors-tagged.js";
import { InternalError, InvalidRequestError } from "../errors.js";

import type {
  FrameHandler,
  SendableFrame,
  Transport,
  TransportEffect,
  WebSocketServerHandle,
  WireFrame,
} from "./types.js";

/**
 * WebSocket transport (ARCP v1.1 §8 mandatory).
 *
 * Wraps a single `ws` connection. Used on either side. Frames are JSON,
 * one per WS message; binary sidecar frames are out of scope.
 */
export class WebSocketTransport implements Transport {
  private handler: FrameHandler | null = null;
  private closeHandler: ((err?: Error) => void) | null = null;
  private isClosed = false;
  /** Serializes inbound handler invocations to preserve ordering (see Transport contract). */
  private inboundChain: Promise<void> = Promise.resolve();

  public constructor(private readonly socket: WebSocket) {
    socket.on("message", (data, isBinary) => {
      this.handleMessage(data, isBinary);
    });
    socket.on("close", () => {
      this.fireClose();
    });
    socket.on("error", (err) => {
      this.fireClose(err);
    });
  }

  private handleMessage(data: unknown, isBinary: boolean): void {
    if (isBinary) return; // Binary sidecar frames are not supported.
    const frame = parseWireFrame(data);
    if (frame === null) return;
    const h = this.handler;
    if (h === null) return;
    this.inboundChain = this.inboundChain
      .then(() => h(frame))
      .catch((): void => {
        /* Keep the queue alive; runtime logs protocol errors. */
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
        // `ws`'s typings declare `err: Error | undefined`, but on some
        // Node / OS combinations the callback is invoked with `null`
        // for success. Treat any non-truthy value as success.
        if (err) reject(err);
        else resolve();
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

function parseWireFrame(data: unknown): WireFrame | null {
  const text = wsDataToString(data);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as WireFrame;
}

function wsDataToString(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return Buffer.from(data as ArrayBuffer).toString("utf8");
  }
  return null;
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
    throw new InternalError("WebSocketServer address unavailable");
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

/**
 * Effect-shaped factory for a WebSocket transport. Wraps a raw `ws` socket
 * (NOT a {@link WebSocketTransport} instance) so the inbound side is a
 * `Stream<WireFrame, TaggedTransportError>` instead of a callback. The
 * legacy {@link WebSocketTransport} class is unchanged and is the path
 * currently used by the runtime / client.
 *
 * The socket is expected to be OPEN before this factory is called — see
 * {@link WebSocketTransport.connect} for the open-handshake helper used on
 * the client side.
 */
export function websocketTransportEffect(socket: WebSocket): TransportEffect {
  const state = { closed: false };
  return {
    incoming: makeIncoming(socket, state),
    send: (frame) => makeSend(socket, frame),
    close: Effect.sync(() => {
      if (state.closed) return;
      state.closed = true;
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    }),
    isClosed: () => state.closed || socket.readyState === WebSocket.CLOSED,
  };
}

function makeIncoming(
  socket: WebSocket,
  state: { closed: boolean },
): Stream.Stream<WireFrame, TaggedTransportError> {
  return Stream.async<WireFrame, TaggedTransportError>((emit) => {
    const onMessage = (data: unknown, isBinary: boolean): void => {
      if (isBinary) return;
      const frame = parseWireFrame(data);
      if (frame === null) return;
      void emit.single(frame);
    };
    const onClose = (): void => {
      state.closed = true;
      void emit.end();
    };
    const onError = (err: Error): void => {
      state.closed = true;
      void emit.fail(new TaggedTransportError({ cause: err, kind: "receive" }));
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
    socket.on("error", onError);
    return Effect.sync(() => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
    });
  });
}

function makeSend(
  socket: WebSocket,
  frame: SendableFrame,
): Effect.Effect<void, TaggedTransportError> {
  return Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        socket.send(JSON.stringify(frame), (err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
    catch: (cause) => new TaggedTransportError({ cause, kind: "send" }),
  });
}
