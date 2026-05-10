import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
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
} from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

interface TransportFixture {
  name: string;
  setup(): Promise<{
    client: ARCPClient;
    cleanup: () => Promise<void>;
    server: ARCPServer | null;
  }>;
}

const TEST_RUNTIME = {
  kind: "test-runtime",
  version: "0.1.0",
  trust_level: "trusted" as const,
};

const fixtures: TransportFixture[] = [
  {
    name: "websocket",
    async setup() {
      const server = new ARCPServer({
        runtime: TEST_RUNTIME,
        capabilities: { streaming: true, durable_jobs: true },
        bearer: new StaticBearerVerifier(new Map([["tok", { principal: "tester" }]])),
        logger: silentLogger,
      });
      server.registerTool("ping", async (args) => ({ echoed: args }));
      const wss = await startWebSocketServer({
        onTransport: (t: Transport) => {
          server.accept(t);
        },
      });
      const client = new ARCPClient({
        client: { kind: "test", version: "0.0.1" },
        capabilities: { streaming: true },
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
      const tsxBin = resolve(here, "..", "..", "node_modules", ".bin", "tsx");
      const runtimeScript = resolve(here, "..", "helpers", "stdio-runtime.ts");
      const child: ChildProcessWithoutNullStreams = spawn(tsxBin, [runtimeScript, ":memory:"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stderr.on("data", () => undefined);
      const client = new ARCPClient({
        client: { kind: "test", version: "0.0.1" },
        capabilities: { streaming: true },
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
            child.on("exit", () => r());
          });
        },
      };
    },
  },
];

for (const fixture of fixtures) {
  describe(`§22 transport: ${fixture.name}`, () => {
    let setup: Awaited<ReturnType<TransportFixture["setup"]>> | null = null;

    afterAll(async () => {
      if (setup !== null) {
        await setup.cleanup();
      }
    });

    it("completes the §8 handshake and runs a tool round-trip", async () => {
      setup = await fixture.setup();
      const out = await setup.client.invoke("ping", { x: 42 });
      expect(out.result.value).toEqual({ echoed: { x: 42 } });
    });

    it("rejects unknown tool with UNIMPLEMENTED via nack", async () => {
      if (setup === null) setup = await fixture.setup();
      await expect(setup.client.invoke("unknown.tool", {})).rejects.toBeInstanceOf(ARCPError);
    });
  });
}
