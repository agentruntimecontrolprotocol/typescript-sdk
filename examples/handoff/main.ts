/** Cheap-tier first; escalate to deep tier via agent.handoff. */
import { createHash, randomUUID } from "node:crypto";
import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  buildEnvelope,
  InternalError,
  newArtifactId,
  newMessageId,
  nowTimestamp,
  UnauthenticatedError,
} from "../../src/index.js";

import { attempt } from "./cheap.js";

const CONFIDENCE_THRESHOLD = 0.65;
const DEEP_URL = "wss://opus-pool.tier3.internal";
const DEEP_KIND = "arcp-opus-pool";
const DEEP_FINGERPRINT = "sha256:0a37bf7d61cca21f00..."; // pinned

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;
declare function sessionId(client: ARCPClient): string;

async function packageContext(
  client: ARCPClient,
  args: { transcript: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const body = Buffer.from(JSON.stringify(args.transcript));
  const artifactId = newArtifactId();
  const reply = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "artifact.put",
      timestamp: nowTimestamp(),
      payload: {
        artifact_id: artifactId,
        media_type: "application/json",
        size: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
        data: body.toString("base64"),
      },
    }) as BaseEnvelope,
    15_000,
  );
  if (reply.type !== "artifact.ref") {
    throw new InternalError({ message: `got ${reply.type}` });
  }
  return reply.payload as Record<string, unknown>;
}

async function emitHandoff(
  client: ARCPClient,
  args: { artifactRef: Record<string, unknown>; traceId: string },
): Promise<void> {
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "agent.handoff",
      timestamp: nowTimestamp(),
      optional: { trace_id: args.traceId },
      payload: {
        target_runtime: { url: DEEP_URL, kind: DEEP_KIND, fingerprint: DEEP_FINGERPRINT },
        session_id: sessionId(client),
        // Spec gestures at shared_memory_ref (RFC §14); we use it
        // explicitly so the deep tier knows where the transcript lives.
        shared_memory_ref: args.artifactRef,
      },
    }) as BaseEnvelope,
  );
}

async function main(): Promise<void> {
  const cheap = null as unknown as ARCPClient; // transport=WebSocketTransport(CHEAP_URL), pinned
  const accepted = await cheap.connect(null as never);
  // Pin runtime kind + fingerprint (RFC §8.3); refuse on mismatch.
  if (accepted.runtime.kind !== "arcp-haiku-pool") {
    throw new UnauthenticatedError({ message: "cheap kind mismatch" });
  }

  const reqText = "what does CRDT stand for?";
  const traceId = `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const [answer, confidence] = await attempt(reqText);
  if (confidence >= CONFIDENCE_THRESHOLD) {
    process.stdout.write(`${answer}\n`);
  } else {
    const artifact = await packageContext(cheap, {
      transcript: {
        user_request: reqText,
        transcript: [
          { role: "user", content: reqText },
          { role: "assistant", content: answer },
        ],
        cheap_confidence: confidence,
      },
    });
    await emitHandoff(cheap, { artifactRef: artifact, traceId });
    process.stdout.write(`[handed off to ${DEEP_KIND} trace_id=${traceId}]\n`);
  }

  await cheap.close();
}

void main();
