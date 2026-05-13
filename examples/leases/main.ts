/** Sandboxed on-call agent. Lease-gated shell, reasoning streamed. */

import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  ARCPError,
  buildEnvelope,
  newMessageId,
  newStreamId,
  nowTimestamp,
  PermissionDeniedError,
} from "../../src/index.js";

import { type LLMStep, llmLoop } from "./agent.js";

const READ_BINARIES = new Set([
  "/usr/bin/journalctl",
  "/usr/bin/cat",
  "/usr/bin/ss",
  "/usr/bin/ps",
]);
const WRITE_BINARIES = new Set(["/usr/bin/systemctl", "/usr/bin/kill"]);
const READ_LEASE_SECONDS = 30 * 60;
const WRITE_LEASE_SECONDS = 60;

function classify(
  argv: string[],
  host: string,
): { permission: string; resource: string; operation: string; seconds: number } {
  const [binary] = argv as [string, ...string[]];
  if (READ_BINARIES.has(binary)) {
    return {
      permission: "host.read",
      resource: `host:${host}`,
      operation: "read",
      seconds: READ_LEASE_SECONDS,
    };
  }
  if (WRITE_BINARIES.has(binary)) {
    const target = (binary === "/usr/bin/systemctl" ? argv[2] : argv[1]) ?? "";
    return {
      permission: "host.write",
      resource: `host:${host}/${binary}/${target}`,
      operation: "write",
      seconds: WRITE_LEASE_SECONDS,
    };
  }
  throw new PermissionDeniedError(`binary not allowed: ${binary}`);
}

// Illustrative `client.request()` shape: send + await correlated reply.
// In the real SDK this is wrapped in a `request()` helper or PendingRegistry.
declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;

async function acquireLease(
  client: ARCPClient,
  args: {
    permission: string;
    resource: string;
    operation: string;
    seconds: number;
    reason: string;
  },
): Promise<string> {
  const reply = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "permission.request",
      timestamp: nowTimestamp(),
      payload: {
        permission: args.permission,
        resource: args.resource,
        operation: args.operation,
        reason: args.reason,
        requested_lease_seconds: args.seconds,
      },
    }) as BaseEnvelope,
    120_000,
  );
  if (reply.type === "permission.deny") {
    const reason = (reply.payload as { reason?: string })?.reason ?? "denied";
    throw new PermissionDeniedError(reason);
  }
  return String((reply.payload as { lease_id: string }).lease_id);
}

async function runCommand(
  client: ARCPClient,
  argv: string[],
  args: { reason: string; host: string },
): Promise<string> {
  const c = classify(argv, args.host);
  const lease = await acquireLease(client, { ...c, reason: args.reason });
  // The lease is the only guard. Spawn the subprocess elsewhere.
  return `<would run ${argv.join(" ")} under lease ${lease}>`;
}

async function emitThought(
  client: ARCPClient,
  args: { streamId: string; sequence: number; text: string },
): Promise<void> {
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "stream.chunk",
      timestamp: nowTimestamp(),
      optional: { stream_id: args.streamId },
      payload: {
        sequence: args.sequence,
        kind: "thought",
        role: "assistant_thought",
        content: args.text,
      },
    }) as BaseEnvelope,
  );
}

async function main(): Promise<void> {
  const client = null as unknown as ARCPClient; // transport, identity (constrained), auth elided

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

  let seq = 0;
  for await (const step of llmLoop("api-gateway pod is OOMing every 4 minutes")) {
    const s: LLMStep = step;
    await emitThought(client, { streamId, sequence: seq, text: s.thought });
    seq += 1;
    if (s.toolCall !== undefined) {
      try {
        await runCommand(client, s.toolCall.argv, {
          reason: s.toolCall.reason,
          host: "edge-pod-04",
        });
      } catch (err) {
        if (err instanceof ARCPError) continue; // PERMISSION_DENIED feeds the next prompt
        throw err;
      }
    }
    if (s.final !== undefined) {
      process.stdout.write(`${s.final}\n`);
      break;
    }
  }

  await client.close();
}

void main();
