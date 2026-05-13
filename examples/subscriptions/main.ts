/**
 * Boot three Observer clients on a single producing session.
 */

import type { BaseEnvelope } from "../../src/index.js";
import { type ARCPClient, buildEnvelope, newMessageId, nowTimestamp } from "../../src/index.js";

import { OTLPSink } from "./sinks/otlp_sink.js";
import { SQLiteSink } from "./sinks/sqlite_sink.js";
import { StdoutSink } from "./sinks/stdout_sink.js";

const STDOUT_TYPES = [
  "log",
  "job.started",
  "job.progress",
  "job.completed",
  "job.failed",
  "tool.error",
];
const OTLP_TYPES = ["metric", "trace.span"];

async function subscribe(
  client: ARCPClient,
  opts: { sessionId: string; types?: string[] },
): Promise<{ subscriptionId: string; feed: AsyncIterator<BaseEnvelope> }> {
  const filter: Record<string, unknown> = { session_id: [opts.sessionId] };
  if (opts.types !== undefined) filter["types"] = opts.types;
  const sub = await client.subscribe({ filter });
  return { subscriptionId: sub.subscriptionId, feed: sub.feed };
}

function unwrapEvent(envelope: BaseEnvelope): BaseEnvelope | null {
  // `client.subscribe()` already unwraps `subscribe.event`; pass-through here
  // mirrors the Python helper for parity.
  if (envelope.type === "subscribe.event") {
    const inner = (envelope.payload as { event?: unknown })?.event;
    return typeof inner === "object" && inner !== null ? (inner as BaseEnvelope) : null;
  }
  return envelope;
}

async function unsubscribe(client: ARCPClient, subscriptionId: string): Promise<void> {
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "unsubscribe",
      timestamp: nowTimestamp(),
      payload: {},
      optional: { subscription_id: subscriptionId },
    }),
  );
}

async function attach(
  types: string[] | undefined,
  handler: (env: BaseEnvelope) => Promise<void>,
): Promise<void> {
  const client = null as unknown as ARCPClient; // transport, identity, auth elided
  const sub = await subscribe(client, {
    sessionId: "...",
    ...(types !== undefined ? { types } : {}),
  });
  try {
    for (;;) {
      const next = await sub.feed.next();
      if (next.done) break;
      const inner = unwrapEvent(next.value);
      if (inner !== null) await handler(inner);
    }
  } finally {
    await unsubscribe(client, sub.subscriptionId);
    await client.close();
  }
}

async function main(): Promise<void> {
  const stdout = new StdoutSink();
  const otlp = new OTLPSink({ endpoint: "..." });
  const sqlite = new SQLiteSink({ path: "replay.sqlite" });
  await sqlite.open();
  try {
    await Promise.all([
      attach(STDOUT_TYPES, (e) => stdout.handle(e)),
      attach(undefined, (e: BaseEnvelope) => sqlite.handle(e) as Promise<void>),
      attach(OTLP_TYPES, (e) => otlp.handle(e)),
    ]);
  } finally {
    await sqlite.close();
  }
}

void main();
