/**
 * Tiny child-process harness used by the resume process-kill test.
 *
 * Reads ARCP frames over stdio (newline-delimited JSON), runs an in-process
 * server with a fixed-path SQLite event log, and registers a "ping" tool that
 * returns its arguments. Intended to be spawned from a parent test; killed
 * via SIGKILL between runs.
 *
 * Usage:
 *   tsx test/helpers/stdio-runtime.ts <event-log-path>
 */
import process from "node:process";
import {
  ARCPServer,
  EventLog,
  StaticBearerVerifier,
  StdioTransport,
  silentLogger,
} from "../../src/index.js";

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write("usage: stdio-runtime.ts <event-log-path>\n");
  process.exit(2);
}

const eventLog = new EventLog({ path });
const server = new ARCPServer({
  runtime: { kind: "test-runtime", version: "0.1.0", trust_level: "trusted" },
  capabilities: { streaming: true, durable_jobs: true },
  bearer: new StaticBearerVerifier(new Map([["tok-test", { principal: "tester" }]])),
  eventLog,
  logger: silentLogger,
});

server.registerTool("ping", async (args) => ({ echoed: args }));
server.registerTool("count", async (args, ctx) => {
  const n = typeof args["n"] === "number" ? (args["n"] as number) : 1;
  for (let i = 0; i < n; i++) {
    await ctx.emitProgress({ percent: ((i + 1) / n) * 100 });
  }
  return { final: n };
});

const transport = StdioTransport.fromProcess();
server.accept(transport);

// Keep the process alive until stdin closes.
process.stdin.on("end", () => {
  process.exit(0);
});
