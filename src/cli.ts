#!/usr/bin/env node
/**
 * `arcp` — small CLI for serving, tailing, and replaying an ARCP runtime.
 * Implemented with `commander`. User-visible output is written to stdout
 * via `process.stdout.write` (per package conventions); diagnostics go to
 * the pino logger when verbose.
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
  .option("--principal <principal>", "Principal bound to the token", "anonymous")
  .action(async (opts) => {
    const eventLog = new EventLog({ path: opts.db });
    const server = new ARCPServer({
      runtime: { kind: "arcp-cli", version: IMPL_VERSION, trust_level: "trusted" },
      capabilities: { streaming: true, durable_jobs: true, subscriptions: true, artifacts: true },
      bearer: new StaticBearerVerifier(new Map([[opts.token, { principal: opts.principal }]])),
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
  .command("send")
  .description("Send a single envelope and print the next response")
  .requiredOption("--url <url>", "WebSocket URL of the runtime")
  .requiredOption("--token <token>", "Bearer token")
  .requiredOption("--type <type>", "Envelope type (e.g. ping, tool.invoke)")
  .option("--payload <json>", "JSON payload (default {})", "{}")
  .action(async (opts) => {
    const client = new ARCPClient({
      client: { kind: "arcp-cli", version: IMPL_VERSION },
      capabilities: { streaming: true },
      authScheme: "bearer",
      token: opts.token,
      logger: silentLogger,
    });
    const transport = await WebSocketTransport.connect(opts.url);
    await client.connect(transport);
    let payload: unknown;
    try {
      payload = JSON.parse(opts.payload);
    } catch {
      process.stderr.write("send: --payload is not valid JSON\n");
      process.exit(1);
    }
    if (opts.type === "tool.invoke") {
      const args = (payload as { tool?: string; arguments?: Record<string, unknown> }) ?? {};
      const tool = args.tool;
      if (typeof tool !== "string") {
        process.stderr.write("send: tool.invoke payload must include {tool}\n");
        process.exit(1);
      }
      const out = await client.invoke(tool, args.arguments ?? {});
      process.stdout.write(`${JSON.stringify(out.result, null, 2)}\n`);
    } else {
      process.stderr.write(`send: type "${opts.type}" not supported by this CLI shortcut\n`);
      process.exit(1);
    }
    await client.close();
  });

program
  .command("tail")
  .description("Subscribe to a session's events and print them")
  .requiredOption("--url <url>", "WebSocket URL of the runtime")
  .requiredOption("--token <token>", "Bearer token")
  .option("--types <list>", "Comma-separated message types to filter")
  .action(async (opts) => {
    const client = new ARCPClient({
      client: { kind: "arcp-cli", version: IMPL_VERSION },
      capabilities: { streaming: true },
      authScheme: "bearer",
      token: opts.token,
      logger: silentLogger,
    });
    const transport = await WebSocketTransport.connect(opts.url);
    await client.connect(transport);
    const types: string[] | undefined =
      opts.types !== undefined && typeof opts.types === "string"
        ? (opts.types as string).split(",")
        : undefined;
    const sub = await client.subscribe({
      filter: types !== undefined ? { types } : {},
    });
    process.stdout.write(`tailing subscription ${sub.subscriptionId}\n`);
    for await (const env of sub.feed) {
      process.stdout.write(`${JSON.stringify(env)}\n`);
    }
    await client.close();
  });

program
  .command("replay")
  .description("Dump events from a SQLite event log")
  .requiredOption("--db <path>", "SQLite event log path")
  .requiredOption("--session <id>", "Session id")
  .option("--after <id>", "Start after this message id", "")
  .action(async (opts) => {
    const eventLog = new EventLog({ path: opts.db, readonly: true });
    const events = await eventLog.readSince(opts.session, opts.after, 100_000);
    for (const env of events) {
      process.stdout.write(`${JSON.stringify(env)}\n`);
    }
    await eventLog.close();
  });

// Manifest command for tools that want to introspect what this CLI supports.
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
