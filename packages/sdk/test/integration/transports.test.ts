import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  ARCPClient,
  ARCPError,
  ARCPServer,
  StaticBearerVerifier,
  StdioTransport,
  silentLogger,
  startWebSocketServer,
  type Transport,
  WebSocketTransport,
} from "@arcp/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));

interface TransportFixture {
  name: string;
  setup(): Promise<{
    client: ARCPClient;
    cleanup: () => Promise<void>;
    server: ARCPServer | null;
  }>;
}

const TEST_RUNTIME = {
  name: "test-runtime",
  version: "0.1.0",
};

const fixtures: TransportFixture[] = [
  {
    name: "websocket",
    async setup() {
      const server = new ARCPServer({
        runtime: TEST_RUNTIME,
        capabilities: { encodings: ["json"] },
        bearer: new StaticBearerVerifier(
          new Map([["tok", { principal: "tester" }]]),
        ),
        logger: silentLogger,
      });
      server.registerAgent("ping", async (input) => ({ echoed: input }));
      const wss = await startWebSocketServer({
        onTransport: (t: Transport) => {
          server.accept(t);
        },
      });
      const client = new ARCPClient({
        client: { name: "test", version: "0.0.1" },
        capabilities: { encodings: ["json"] },
        authScheme: "bearer",
        token: "tok",
        logger: silentLogger,
        handshakeTimeoutMs: 5000,
      });
      const transport = await WebSocketTransport.connect(wss.url);
      await client.connect(transport);
      return {
        client,
        server,
        cleanup: async () => {
          await client.close();
          await server.close();
          await wss.close();
        },
      };
    },
  },
  {
    name: "stdio",
    async setup() {
      const tsxBin = path.resolve(
        here,
        "..",
        "..",
        "node_modules",
        ".bin",
        "tsx",
      );
      const runtimeScript = path.resolve(
        here,
        "..",
        "helpers",
        "stdio-runtime.ts",
      );
      const child: ChildProcessWithoutNullStreams = spawn(
        tsxBin,
        [runtimeScript, ":memory:"],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      child.stderr.on("data", () => undefined);
      const client = new ARCPClient({
        client: { name: "test", version: "0.0.1" },
        capabilities: { encodings: ["json"] },
        authScheme: "bearer",
        token: "tok-test",
        logger: silentLogger,
        handshakeTimeoutMs: 5000,
      });
      const transport = StdioTransport.fromChild(child);
      await client.connect(transport);
      return {
        client,
        server: null,
        cleanup: async () => {
          await client.close();
          child.kill("SIGKILL");
          await new Promise<void>((r) => {
            child.on("exit", () => {
              r();
            });
          });
        },
      };
    },
  },
];

for (const fixture of fixtures) {
  describe(`§4 transport: ${fixture.name}`, () => {
    let setup: Awaited<ReturnType<TransportFixture["setup"]>> | null = null;

    afterAll(async () => {
      if (setup !== null) {
        await setup.cleanup();
      }
    });

    it("completes the §6 handshake and runs an agent round-trip", async () => {
      setup = await fixture.setup();
      const handle = await setup.client.submit({
        agent: "ping",
        input: { x: 42 },
      });
      const result = await handle.done;
      expect(result.final_status).toBe("success");
      expect(result.result).toEqual({ echoed: { x: 42 } });
    });

    it("rejects unknown agent with AGENT_NOT_AVAILABLE", async () => {
      setup ??= await fixture.setup();
      await expect(
        setup.client.submit({ agent: "unknown.agent" }),
      ).rejects.toBeInstanceOf(ARCPError);
    });
  });
}
