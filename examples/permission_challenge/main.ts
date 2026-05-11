/** Generator proposes; reviewer holds veto via permission.request. */
import { createHash } from "node:crypto";
import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  type ARCPError,
  buildEnvelope,
  FailedPreconditionError,
  newMessageId,
  nowTimestamp,
  PermissionDeniedError,
} from "../../src/index.js";

import { type Patch, propose, type ReviewVerdict, review } from "./agents.js";

const MAX_REVISIONS = 4;

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;

function fingerprint(diff: string): string {
  return createHash("sha256").update(diff).digest("hex").slice(0, 16);
}

async function requestApply(
  client: ARCPClient,
  args: { ticketId: string; patch: Patch },
): Promise<string> {
  const fp = fingerprint(args.patch.diff);
  const reply = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "permission.request",
      timestamp: nowTimestamp(),
      // Same key per (ticket, diff): identical patch dedupes at runtime.
      optional: { idempotency_key: `review:${args.ticketId}:${fp}` },
      payload: {
        permission: "repo.write",
        resource: `ticket:${args.ticketId}/${fp}`,
        operation: "apply_patch",
        reason: "apply patch",
        requested_lease_seconds: 90,
      },
    }) as BaseEnvelope,
    300_000,
  );
  if (reply.type === "permission.deny") {
    const reason = (reply.payload as { reason?: string })?.reason ?? "denied";
    throw new PermissionDeniedError({ message: reason });
  }
  return String((reply.payload as { lease_id: string }).lease_id);
}

async function respond(
  client: ARCPClient,
  args: { request: BaseEnvelope; verdict: ReviewVerdict },
): Promise<void> {
  const reqPayload = args.request.payload as Record<string, unknown>;
  if (args.verdict.grant) {
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "permission.grant",
        timestamp: nowTimestamp(),
        optional: { correlation_id: args.request.id },
        payload: {
          permission: reqPayload.permission,
          resource: reqPayload.resource,
          operation: reqPayload.operation,
          lease_seconds: 90,
        },
      }) as BaseEnvelope,
    );
  } else {
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "permission.deny",
        timestamp: nowTimestamp(),
        optional: { correlation_id: args.request.id },
        payload: {
          permission: reqPayload.permission,
          reason: args.verdict.reason,
          code: "FAILED_PRECONDITION",
        },
      }) as BaseEnvelope,
    );
  }
}

async function reviewerLoop(reviewer: ARCPClient, ticket: string): Promise<void> {
  reviewer.on("permission.request", async (env) => {
    const verdict = await review({ ticket, request: env });
    await respond(reviewer, { request: env, verdict });
  });
}

async function main(): Promise<void> {
  // Two sessions, one per agent. In production they'd be in different
  // processes on different runtimes; the message contract is identical.
  const generator = null as unknown as ARCPClient;
  const reviewer = null as unknown as ARCPClient;

  const ticketId = "JIRA-4812";
  const ticket = "Reject JWTs whose `aud` does not match the configured audience. Add a unit test.";
  await reviewerLoop(reviewer, ticket);

  let priorDenial: string | undefined;
  try {
    for (let i = 0; i < MAX_REVISIONS; i++) {
      const patch = await propose({ ticket, priorDenial });
      try {
        const lease = await requestApply(generator, { ticketId, patch });
        process.stdout.write(`applied ${fingerprint(patch.diff)} lease=${lease}\n`);
        return;
      } catch (err) {
        if (err instanceof PermissionDeniedError || err instanceof FailedPreconditionError) {
          priorDenial = (err as ARCPError).message;
          continue;
        }
        throw err;
      }
    }
    process.stdout.write("abandoned after max_revisions\n");
  } finally {
    await generator.close();
    await reviewer.close();
  }
}

void main();
