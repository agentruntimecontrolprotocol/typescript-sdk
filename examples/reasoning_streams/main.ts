/** Primary emits reasoning; mirror peer subscribes, critiques back. */

import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  buildEnvelope,
  newMessageId,
  newStreamId,
  nowTimestamp,
} from "../../src/index.js";

import { critiqueThought, primaryStep } from "./agents.js";

const MAX_DEPTH = 3;
const TOKEN_BUDGET = 8_000;

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;
declare function sessionId(client: ARCPClient): string;

// Primary side -----------------------------------------------------------

async function runPrimary(
  client: ARCPClient,
  args: { request: string; inboundCritiques: AsyncIterable<Record<string, unknown>> },
): Promise<string> {
  const streamId = newStreamId();
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "stream.open",
      timestamp: nowTimestamp(),
      optional: { stream_id: streamId },
      payload: { kind: "thought" },
    }) as BaseEnvelope,
  );

  let last: Record<string, unknown> | null = null;
  let answer = "";
  const it = args.inboundCritiques[Symbol.asyncIterator]();
  for (let step = 0; step < MAX_DEPTH; step++) {
    answer = await primaryStep(args.request, last);
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "stream.chunk",
        timestamp: nowTimestamp(),
        optional: { stream_id: streamId },
        payload: { sequence: step, kind: "thought", role: "assistant_thought", content: answer },
      }) as BaseEnvelope,
    );
    const next = await Promise.race([
      it.next(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), 5_000),
      ),
    ]);
    if (next.done) {
      last = null;
      continue;
    }
    last = next.value;
    if (last.severity === "halt") break;
  }
  return answer;
}

// Mirror side (a peer runtime, NOT a pure observer — it both reads the
// thought stream AND delegates critique events back) --------------------

async function subscribeThoughts(
  mirror: ARCPClient,
  args: { targetSessionId: string },
): Promise<string> {
  const accepted = await request(
    mirror,
    buildEnvelope({
      id: newMessageId(),
      type: "subscribe",
      timestamp: nowTimestamp(),
      payload: {
        filter: { session_id: [args.targetSessionId], types: ["stream.chunk"] },
      },
    }) as BaseEnvelope,
    10_000,
  );
  return String((accepted.payload as { subscription_id: string }).subscription_id);
}

function isThought(env: BaseEnvelope): boolean {
  if (env.type !== "stream.chunk") return false;
  const p = env.payload as { kind?: string; role?: string };
  return p.kind === "thought" || p.role === "assistant_thought";
}

async function runMirror(mirror: ARCPClient, args: { targetSessionId: string }): Promise<void> {
  const subId = await subscribeThoughts(mirror, args);
  let spent = 0;
  mirror.on("subscribe.event", async (env) => {
    const inner = (env.payload as { event?: BaseEnvelope }).event;
    if (inner === undefined || !isThought(inner)) return;
    if (spent >= TOKEN_BUDGET) {
      // Tear down cleanly: runtime stops paying for events we'll never act on.
      await mirror.send(
        buildEnvelope({
          id: newMessageId(),
          type: "unsubscribe",
          timestamp: nowTimestamp(),
          optional: { subscription_id: subId },
          payload: {},
        }) as BaseEnvelope,
      );
      return;
    }

    const [severity, summary, suggestion, consumed] = await critiqueThought(
      String((inner.payload as { content?: unknown })?.content ?? ""),
    );
    spent += consumed;
    await mirror.send(
      buildEnvelope({
        id: newMessageId(),
        type: "agent.delegate",
        timestamp: nowTimestamp(),
        payload: {
          target: args.targetSessionId,
          task: "consume_critique",
          context: {
            critique: {
              target_thought_sequence: Number(
                (inner.payload as { sequence?: number }).sequence ?? 0,
              ),
              severity,
              summary,
              suggestion,
              consumed_tokens: consumed,
            },
          },
        },
      }) as BaseEnvelope,
    );
  });
}

async function main(): Promise<void> {
  const primary = null as unknown as ARCPClient; // transport, identity, auth elided
  const mirror = null as unknown as ARCPClient;

  const inbound: Record<string, unknown>[] = [];
  const wakers: ((v: IteratorResult<Record<string, unknown>>) => void)[] = [];
  const queue: AsyncIterable<Record<string, unknown>> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          const head = inbound.shift();
          if (head !== undefined) {
            return Promise.resolve({ value: head, done: false });
          }
          return new Promise((r) => wakers.push(r));
        },
      };
    },
  };

  primary.on("agent.delegate", (env) => {
    const critique = (env.payload as { context?: { critique?: Record<string, unknown> } }).context
      ?.critique;
    if (critique !== undefined) {
      const w = wakers.shift();
      if (w !== undefined) w({ value: critique, done: false });
      else inbound.push(critique);
    }
  });

  void runMirror(mirror, { targetSessionId: sessionId(primary) });

  const answer = await runPrimary(primary, {
    request: "Argue both sides: serializable vs snapshot iso?",
    inboundCritiques: queue,
  });
  process.stdout.write(`${answer}\n`);

  await primary.close();
  await mirror.close();
}

void main();
