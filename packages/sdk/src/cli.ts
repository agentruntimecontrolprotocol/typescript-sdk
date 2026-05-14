#!/usr/bin/env node
/**
 * `arcp` — small CLI for serving and replaying an ARCP v1.0 runtime.
 */
import { readFileSync } from "node:fs";
import process from "node:process";
import { Command } from "commander";
import {
  ARCPClient,
  ARCPServer,
  EventLog,
  IMPL_VERSION,
  PROTOCOL_VERSION,
  StaticBearerVerifier,
  StdioTransport,
  silentLogger,
  startWebSocketServer,
  WebSocketTransport,
} from "./index.js";

const program = new Command();
program
  .name("arcp")
  .description("ARCP reference CLI")
  .version(`${IMPL_VERSION} (protocol ${PROTOCOL_VERSION})`);

program
  .command("serve")
  .description("Run an ARCP server (WebSocket by default)")
  .option("--transport <kind>", "ws | stdio", "ws")
  .option("--host <host>", "WebSocket bind host", "127.0.0.1")
  .option("--port <port>", "WebSocket bind port (0 = ephemeral)", "0")
  .option("--db <path>", "SQLite event log path (default :memory:)", ":memory:")
  .option("--token <token>", "Static bearer token to accept", "tok")
  .option(
    "--principal <principal>",
    "Principal bound to the token",
    "anonymous",
  )
  .action(async (opts) => {
    const eventLog = new EventLog({ path: opts.db });
    const server = new ARCPServer({
      runtime: { name: "arcp-cli", version: IMPL_VERSION },
      capabilities: { encodings: ["json"] },
      bearer: new StaticBearerVerifier(
        new Map([[opts.token, { principal: opts.principal }]]),
      ),
      eventLog,
      logger: silentLogger,
    });

    if (opts.transport === "stdio") {
      const transport = StdioTransport.fromProcess();
      server.accept(transport);
      process.stderr.write("arcp serve: stdio transport ready\n");
      return;
    }

    const wss = await startWebSocketServer({
      host: opts.host,
      port: Number.parseInt(opts.port, 10),
      onTransport: (t) => {
        server.accept(t);
      },
    });
    process.stdout.write(`arcp serve: listening on ${wss.url}\n`);
  });

program
  .command("submit")
  .description("Submit a job to a runtime and print the terminal result")
  .requiredOption("--url <url>", "WebSocket URL of the runtime")
  .requiredOption("--token <token>", "Bearer token")
  .requiredOption("--agent <agent>", "Agent name to invoke")
  .option("--input <json>", "JSON input passed to the agent (default {})", "{}")
  .option("--idempotency-key <key>", "Idempotency key")
  .option("--max-runtime <sec>", "Max runtime in seconds")
  .action(async (opts) => {
    const client = new ARCPClient({
      client: { name: "arcp-cli", version: IMPL_VERSION },
      capabilities: { encodings: ["json"] },
      authScheme: "bearer",
      token: opts.token,
      logger: silentLogger,
    });
    const transport = await WebSocketTransport.connect(opts.url);
    await client.connect(transport);
    let input: unknown;
    try {
      input = JSON.parse(opts.input);
    } catch {
      process.stderr.write("submit: --input is not valid JSON\n");
      process.exit(1);
    }
    const handle = await client.submit({
      agent: opts.agent,
      input,
      ...(opts.idempotencyKey !== undefined
        ? { idempotencyKey: opts.idempotencyKey }
        : {}),
      ...(opts.maxRuntime !== undefined
        ? { maxRuntimeSec: Number.parseInt(opts.maxRuntime, 10) }
        : {}),
    });
    try {
      const result = await handle.done;
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
      await client.close();
    }
  });

program
  .command("replay")
  .description("Dump events from a SQLite event log")
  .requiredOption("--db <path>", "SQLite event log path")
  .requiredOption("--session <id>", "Session id")
  .option(
    "--after-seq <n>",
    "Replay events with event_seq strictly greater than n",
    "0",
  )
  .action(async (opts) => {
    const eventLog = new EventLog({ path: opts.db, readonly: true });
    const events = await eventLog.readSinceSeq(
      opts.session,
      Number.parseInt(opts.afterSeq, 10),
      100_000,
    );
    for (const env of events) {
      process.stdout.write(`${JSON.stringify(env)}\n`);
    }
    await eventLog.close();
  });

program
  .command("manifest")
  .description("Print the package manifest and supported message types")
  .action(() => {
    const manifest = {
      name: "arcp",
      version: IMPL_VERSION,
      protocol_version: PROTOCOL_VERSION,
    };
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  });

// Self-check ensures the package can find its own version on disk; no-op
// otherwise, but kept here for readers of the CLI to reason about packaging.
void readFileSync;

await program.parseAsync(process.argv);
