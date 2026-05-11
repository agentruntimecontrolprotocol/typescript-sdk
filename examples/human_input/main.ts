/** Fan `human.input.request` across channels; resolve on first. */

import type { BaseEnvelope } from "../../src/index.js";
import { type ARCPClient, buildEnvelope, newMessageId, nowTimestamp } from "../../src/index.js";

import { REGISTRY } from "./channels.js";

const DESTINATIONS = ["ntfy:phone", "email:oncall", "slack:ops"];

async function fanOut(client: ARCPClient, request: BaseEnvelope): Promise<void> {
  const payload = request.payload as {
    response_schema?: Record<string, unknown>;
    prompt?: string;
    expires_at: string;
  };
  const schema = payload.response_schema ?? {};
  const prompt = String(payload.prompt ?? "");
  const expiresAt = new Date(payload.expires_at);
  const timeoutMs = Math.max(0, expiresAt.getTime() - Date.now());

  const tasks = DESTINATIONS.map((dest) => {
    const p = REGISTRY[dest]?.(prompt, schema).then(
      (value) => ({ dest, value }),
      (err: unknown) => ({ dest, error: err }),
    );
    return p;
  });

  const winner = await Promise.race([
    Promise.any(tasks),
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);

  if (winner === null || (winner as { error?: unknown }).error !== undefined) {
    // Deadline elapsed; translate timeout into the cancelled-input
    // shape (RFC §12.4).
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "human.input.cancelled",
        timestamp: nowTimestamp(),
        optional: { correlation_id: request.id },
        payload: { code: "DEADLINE_EXCEEDED", message: "no channel responded before expires_at" },
      }) as BaseEnvelope,
    );
    return;
  }

  const won = winner as { dest: string; value: Record<string, unknown> };
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "human.input.response",
      timestamp: nowTimestamp(),
      optional: { correlation_id: request.id },
      payload: {
        value: won.value,
        responded_by: won.dest,
        responded_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
    }) as BaseEnvelope,
  );
  // Tell the losing destinations the question is settled. Each channel
  // adapter would translate this to "delete the push" / "edit the slack
  // message to '(answered)'".
  const losers = DESTINATIONS.filter((d) => d !== won.dest);
  if (losers.length > 0) {
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "human.input.cancelled",
        timestamp: nowTimestamp(),
        optional: { correlation_id: request.id },
        payload: { code: "OK", message: "answered elsewhere", channels: losers },
      }) as BaseEnvelope,
    );
  }
}

async function main(): Promise<void> {
  const client = null as unknown as ARCPClient; // transport, identity, auth elided
  client.on("human.input.request", (env) => {
    void fanOut(client, env);
  });
  // The client lives until it's closed externally; here we just await forever.
  await new Promise(() => {});
}

void main();
