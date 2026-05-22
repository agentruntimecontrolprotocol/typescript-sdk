/**
 * Tiny child-process harness used by the resume process-kill test.
 *
 * Reads ARCP frames over stdio (newline-delimited JSON), runs an in-process
 * server with a fixed-path SQLite event log, and registers a "ping" agent
 * that returns its input. Intended to be spawned from a parent test; killed
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
} from "@agentruntimecontrolprotocol/sdk";

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write("usage: stdio-runtime.ts <event-log-path>\n");
  process.exit(2);
}

const eventLog = new EventLog({ path });
const server = new ARCPServer({
  runtime: { name: "test-runtime", version: "0.1.0" },
  capabilities: { encodings: ["json"] },
  bearer: new StaticBearerVerifier(
    new Map([["tok-test", { principal: "tester" }]]),
  ),
  eventLog,
  logger: silentLogger,
});

server.registerAgent("ping", async (input: unknown) => ({ echoed: input }));
server.registerAgent("count", async (input: unknown, ctx) => {
  const obj = (
    typeof input === "object" && input !== null ? input : {}
  ) as Record<string, unknown>;
  const n = typeof obj["n"] === "number" ? obj["n"] : 1;
  for (let i = 0; i < n; i++) {
    await ctx.metric({
      name: "progress",
      value: ((i + 1) / n) * 100,
      unit: "percent",
    });
  }
  return { final: n };
});

const transport = StdioTransport.fromProcess();
server.accept(transport);

process.stdin.on("end", () => {
  process.exit(0);
});
