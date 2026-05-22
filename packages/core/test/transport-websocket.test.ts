import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { websocketTransportEffect } from "@agentruntimecontrolprotocol/core";

/**
 * Open an ephemeral WS server on 127.0.0.1, accept one connection, and
 * return both ends as {@link websocketTransportEffect} wrappers plus a
 * teardown helper.
 *
 * Mirrors the port=0 pattern in `packages/sdk/test/integration/transports.test.ts`.
 */
async function openPair(): Promise<{
  client: ReturnType<typeof websocketTransportEffect>;
  server: ReturnType<typeof websocketTransportEffect>;
  cleanup: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => {
      resolve();
    });
    wss.once("error", reject);
  });
  const addr = wss.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("WebSocketServer address unavailable");
  }
  const url = `ws://127.0.0.1:${addr.port}`;

  const serverSocketPromise = new Promise<WebSocket>((resolve) => {
    wss.once("connection", (sock) => {
      resolve(sock);
    });
  });
  const clientSocket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      clientSocket.off("error", onError);
      resolve();
    };
    const onError = (err: Error): void => {
      clientSocket.off("open", onOpen);
      reject(err);
    };
    clientSocket.once("open", onOpen);
    clientSocket.once("error", onError);
  });
  const serverSocket = await serverSocketPromise;

  const client = websocketTransportEffect(clientSocket);
  const server = websocketTransportEffect(serverSocket);
  return {
    client,
    server,
    cleanup: async () => {
      await Effect.runPromise(client.close);
      await Effect.runPromise(server.close);
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => {
          if (err === undefined) resolve();
          else reject(err);
        });
      });
    },
  };
}

describe("websocketTransportEffect", () => {
  it("round-trips a single frame and signals end-of-stream on peer close", async () => {
    const { client, server, cleanup } = await openPair();
    try {
      const received = Effect.runPromise(
        Stream.runCollect(Stream.take(server.incoming, 1)),
      );
      await Effect.runPromise(client.send({ ping: 1 }));
      const chunk = await received;
      expect([...chunk]).toEqual([{ ping: 1 }]);

      // After client.close, server.incoming must terminate (not hang).
      const drained = Effect.runPromise(Stream.runCollect(server.incoming));
      await Effect.runPromise(client.close);
      await drained; // resolves => stream signaled end.
    } finally {
      await cleanup();
    }
  });

  it("delivers 10 frames in order", async () => {
    const { client, server, cleanup } = await openPair();
    try {
      const received = Effect.runPromise(
        Stream.runCollect(Stream.take(server.incoming, 10)),
      );
      for (let i = 0; i < 10; i++) {
        await Effect.runPromise(client.send({ n: i }));
      }
      const chunk = await received;
      const ns = [...chunk].map((f) => f["n"] as number);
      expect(ns).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    } finally {
      await cleanup();
    }
  });
});
