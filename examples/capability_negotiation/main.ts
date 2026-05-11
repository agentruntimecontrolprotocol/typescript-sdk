/** Capability-driven peer routing with ordered fallback + cost rollup. */
import { randomUUID } from "node:crypto";
import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  ARCPError,
  buildEnvelope,
  type ErrorCode,
  newMessageId,
  nowTimestamp,
} from "../../src/index.js";

const PEERS = ["anthropic-haiku", "anthropic-sonnet", "openai-4o", "groq-llama"];
const FALLBACK_CHAINS: Record<string, string[]> = {
  cheap_fast: ["groq-llama", "anthropic-haiku", "openai-4o"],
  balanced: ["anthropic-sonnet", "openai-4o", "anthropic-haiku"],
  deep: ["anthropic-sonnet"],
};
const COST_CEILING_USD_PER_MTOK = 8.0;
const LATENCY_CEILING_MS = 800;
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "ABORTED",
]);

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;
declare function negotiatedCapabilities(client: ARCPClient): Record<string, unknown>;

interface Profile {
  costPerMtok: number;
  p50LatencyMs: number;
  modelClass: string;
}

function profileFrom(caps: Record<string, unknown>): Profile {
  // Capabilities is `extra="allow"` so namespaced fields ride alongside
  // the core booleans. NOTE: §21 covers extension *messages* but not
  // extension *capability values* — load-bearing convention here.
  return {
    costPerMtok: Number(caps["arcpx.market.cost_per_mtok.v1"] ?? 0),
    p50LatencyMs: Number(caps["arcpx.market.p50_latency_ms.v1"] ?? 0),
    modelClass: String(caps["arcpx.market.model_class.v1"] ?? "unknown"),
  };
}

function candidateChain(profiles: Map<string, Profile>, requestClass: string): string[] {
  return (FALLBACK_CHAINS[requestClass] ?? []).filter((name) => {
    const p = profiles.get(name);
    return (
      p !== undefined &&
      p.costPerMtok <= COST_CEILING_USD_PER_MTOK &&
      p.p50LatencyMs <= LATENCY_CEILING_MS
    );
  });
}

async function invokeWithFallback(args: {
  clients: Map<string, ARCPClient>;
  chain: string[];
  tool: string;
  arguments: Record<string, unknown>;
  traceId: string;
}): Promise<BaseEnvelope> {
  // Walk the chain. Retryable error → next peer; otherwise raise.
  let last: ARCPError | undefined;
  for (const name of args.chain) {
    const client = args.clients.get(name);
    if (client === undefined) continue;
    let reply: BaseEnvelope;
    try {
      reply = await request(
        client,
        buildEnvelope({
          id: newMessageId(),
          type: "tool.invoke",
          timestamp: nowTimestamp(),
          optional: {
            trace_id: args.traceId,
            extensions: { "arcpx.market.peer.v1": name },
          },
          payload: { tool: args.tool, arguments: args.arguments },
        }) as BaseEnvelope,
        30_000,
      );
    } catch (exc) {
      if (!(exc instanceof ARCPError)) throw exc;
      last = exc;
      if (RETRYABLE.has(exc.code)) continue;
      throw exc;
    }
    if (reply.type !== "tool.error") return reply;
    const code = ((reply.payload as { code?: string }).code ?? "UNKNOWN") as ErrorCode;
    last = new ARCPError({
      code,
      message: String((reply.payload as { message?: string }).message ?? ""),
    });
    if (RETRYABLE.has(code)) continue;
    throw last;
  }
  throw last ?? new ARCPError({ code: "UNAVAILABLE", message: "no peers available" });
}

interface Usage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  byPeer: Record<string, number>;
}

function consumeMetric(env: BaseEnvelope, totals: Map<string, Usage>): void {
  if (env.type !== "metric") return;
  const p = env.payload as { name?: string; value?: number; dims?: Record<string, string> };
  const dims = p.dims ?? {};
  if (typeof p.value !== "number") return;
  const tenant = dims.tenant ?? "unknown";
  const u = totals.get(tenant) ?? { tokensIn: 0, tokensOut: 0, costUsd: 0, byPeer: {} };
  if (p.name === "tokens.used") {
    if (dims.kind === "input") u.tokensIn += p.value;
    else if (dims.kind === "output") u.tokensOut += p.value;
  } else if (p.name === "cost.usd") {
    u.costUsd += p.value;
    const peer = dims.peer ?? "unknown";
    u.byPeer[peer] = (u.byPeer[peer] ?? 0) + p.value;
  }
  totals.set(tenant, u);
}

async function main(): Promise<void> {
  const clients = new Map<string, ARCPClient>();
  const profiles = new Map<string, Profile>();
  for (const name of PEERS) {
    const c = null as unknown as ARCPClient; // transport per peer URL, identity, auth elided
    clients.set(name, c);
    // Marketplace fields ride on the negotiated capabilities;
    // no extra round trip to learn cost / latency / class.
    profiles.set(name, profileFrom(negotiatedCapabilities(c)));
  }

  const totals = new Map<string, Usage>();
  for (const c of clients.values()) {
    c.on("metric", (env) => consumeMetric(env, totals));
  }

  const chain = candidateChain(profiles, "balanced");
  const reply = await invokeWithFallback({
    clients,
    chain,
    tool: "chat.completion",
    arguments: { prompt: "Hello", tenant: "acme-corp" },
    traceId: `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
  });
  process.stdout.write(
    `chosen= ${(reply as BaseEnvelope & { extensions?: Record<string, unknown> }).extensions?.["arcpx.market.peer.v1"]}\n`,
  );
  process.stdout.write(`usage= ${JSON.stringify([...totals])}\n`);

  for (const c of clients.values()) await c.close();
}

void main();
