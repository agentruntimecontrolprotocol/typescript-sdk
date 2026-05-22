import type { WebSocketTransport } from "@agentruntimecontrolprotocol/core/transport";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { attachArcpToFastify } from "../src/index.js";

describe("@agentruntimecontrolprotocol/fastify", () => {
  it("upgrades a websocket at the configured path", async () => {
    const app = Fastify();
    app.get("/healthz", (_req, reply) => reply.send({ ok: true }));

    const seen: WebSocketTransport[] = [];
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = new URL(address).port;
    const handle = attachArcpToFastify(app, {
      path: "/arcp",
      onTransport: (t) => {
        seen.push(t);
      },
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/arcp`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        resolve();
      });
      ws.once("error", reject);
    });
    // Wait a tick for the onTransport callback to fire on the server.
    await new Promise<void>((r) => {
      setTimeout(r, 20);
    });
    expect(seen.length).toBe(1);
    ws.close();
    await handle.close();
    await app.close();
  });

  it("rejects a forbidden Host header", async () => {
    const app = Fastify();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const port = new URL(address).port;
    const handle = attachArcpToFastify(app, {
      path: "/arcp",
      allowedHosts: ["example.com"],
      onTransport: () => undefined,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/arcp`);
    await expect(
      new Promise<void>((resolve, reject) => {
        ws.once("open", () => {
          resolve();
        });
        ws.once("error", reject);
      }),
    ).rejects.toThrow();

    await handle.close();
    await app.close();
  });
});
