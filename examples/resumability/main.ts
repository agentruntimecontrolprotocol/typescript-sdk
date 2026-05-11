/**
 * Durable research job with real crash and resume.
 *
 *   # First call: crash after `synthesize`. Prints the resume token.
 *   CRASH_AFTER_STEP=synthesize node --import tsx examples/resumability/main.ts
 *
 *   # Second call: pick up from the printed checkpoint.
 *   RESUME_JOB_ID=...  RESUME_AFTER_MSG_ID=...  RESUME_CHECKPOINT_ID=... \
 *     node --import tsx examples/resumability/main.ts
 */
import { createHash } from "node:crypto";
import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  ARCPError,
  buildEnvelope,
  DataLossError,
  newJobId,
  newMessageId,
  nowTimestamp,
} from "../../src/index.js";

import { runStep } from "./steps.js";

const STEPS = ["plan", "gather", "synthesize", "critique", "finalize"] as const;

declare function events(client: ARCPClient): AsyncIterable<BaseEnvelope>;

function stepKey(args: { jobId: string; step: string; salt: string }): string {
  // Deterministic per-step idempotency key (RFC §6.4). Re-issuing the
  // same step with the same input returns the prior outcome instead of
  // re-running the LLM.
  const h = createHash("sha256");
  for (const piece of [args.jobId, args.step, args.salt]) {
    h.update(piece);
    h.update(Buffer.from([0]));
  }
  return `research:${args.jobId}:${args.step}:${h.digest("hex").slice(0, 16)}`;
}

async function emitProgress(
  client: ARCPClient,
  args: { jobId: string; step: string },
): Promise<void> {
  const pct = (100 * (STEPS.indexOf(args.step as (typeof STEPS)[number]) + 1)) / STEPS.length;
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "job.progress",
      timestamp: nowTimestamp(),
      optional: { job_id: args.jobId },
      payload: { percent: pct, message: args.step },
    }) as BaseEnvelope,
  );
}

async function emitCheckpoint(
  client: ARCPClient,
  args: { jobId: string; step: string },
): Promise<string> {
  const chk = `chk_${args.step}_${args.jobId.slice(-6)}`;
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "job.checkpoint",
      timestamp: nowTimestamp(),
      optional: { job_id: args.jobId },
      payload: { checkpoint_id: chk, label: args.step },
    }) as BaseEnvelope,
  );
  return chk;
}

async function executeSteps(args: {
  client: ARCPClient;
  jobId: string;
  request: unknown;
  startingAt: string;
  crashAfter: string | undefined;
}): Promise<unknown> {
  let output: unknown = args.request;
  for (const step of STEPS) {
    if (STEPS.indexOf(step) < STEPS.indexOf(args.startingAt as (typeof STEPS)[number])) continue;
    const key = stepKey({ jobId: args.jobId, step, salt: JSON.stringify(output) });
    await emitProgress(args.client, { jobId: args.jobId, step });
    output = await runStep(args.client, {
      jobId: args.jobId,
      step,
      inputs: { prior: output, idempotency_key: key },
    });
    await emitCheckpoint(args.client, { jobId: args.jobId, step });
    if (args.crashAfter === step) {
      // The whole point of durable jobs: process death is fine.
      // Runtime kept every envelope; resume picks it up.
      process.stdout.write(
        `[crash after ${step}; resume with RESUME_JOB_ID=${args.jobId} ` +
          `RESUME_CHECKPOINT_ID=chk_${step}_${args.jobId.slice(-6)} ` +
          `RESUME_AFTER_MSG_ID=<last id from your event log>]\n`,
      );
      process.exit(137);
    }
  }
  return output;
}

async function issueResume(
  client: ARCPClient,
  args: { jobId: string; afterMessageId: string; checkpointId?: string },
): Promise<string | null> {
  // Replay envelopes; return the last checkpoint label, or null if the
  // job already terminated during replay.
  const payload: Record<string, unknown> = {
    after_message_id: args.afterMessageId,
    include_open_streams: true,
  };
  if (args.checkpointId !== undefined) payload.checkpoint_id = args.checkpointId;
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "resume",
      timestamp: nowTimestamp(),
      optional: { job_id: args.jobId },
      payload,
    }) as BaseEnvelope,
  );

  let last: string | null = null;
  for await (const env of events(client)) {
    if ((env as BaseEnvelope & { job_id?: string }).job_id !== args.jobId) continue;
    if (env.type === "tool.error" && (env.payload as { code?: string }).code === "DATA_LOSS") {
      throw new DataLossError({ message: "retention expired" });
    }
    if (env.type === "job.checkpoint") {
      last = String((env.payload as { label: string }).label);
    } else if (
      env.type === "job.completed" ||
      env.type === "job.failed" ||
      env.type === "job.cancelled"
    ) {
      return null;
    } else if (
      env.type === "event.emit" &&
      (env.payload as { name?: string }).name === "subscription.backfill_complete"
    ) {
      return last; // replay window closed; we're now live
    }
  }
  return last;
}

async function main(): Promise<void> {
  const client = null as unknown as ARCPClient; // transport, identity, auth elided

  const rjId = process.env.RESUME_JOB_ID;
  const rjAfter = process.env.RESUME_AFTER_MSG_ID;
  if (rjId !== undefined && rjAfter !== undefined) {
    const checkpointId = process.env.RESUME_CHECKPOINT_ID;
    const last = await issueResume(client, {
      jobId: rjId,
      afterMessageId: rjAfter,
      ...(checkpointId !== undefined ? { checkpointId } : {}),
    });
    if (last === null) {
      process.stdout.write("already terminal during replay\n");
    } else {
      const nextIdx = STEPS.indexOf(last as (typeof STEPS)[number]) + 1;
      if (nextIdx >= STEPS.length) process.stdout.write("nothing to resume\n");
      else {
        process.stdout.write(`[resuming at ${STEPS[nextIdx]}]\n`);
        const final = await executeSteps({
          client,
          jobId: rjId,
          request: "<replayed>",
          startingAt: STEPS[nextIdx] ?? STEPS[STEPS.length - 1],
          crashAfter: undefined,
        });
        await client.send(
          buildEnvelope({
            id: newMessageId(),
            type: "job.completed",
            timestamp: nowTimestamp(),
            optional: { job_id: rjId },
            payload: { result: final },
          }) as BaseEnvelope,
        );
      }
    }
  } else {
    const jobId = newJobId();
    const reqText = "Survey CRDT-based collaborative editing in 2026.";
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "workflow.start",
        timestamp: nowTimestamp(),
        optional: { job_id: jobId },
        payload: { workflow: "research.v1", arguments: { request: reqText } },
      }) as BaseEnvelope,
    );
    const final = await executeSteps({
      client,
      jobId,
      request: reqText,
      startingAt: STEPS[0],
      crashAfter: process.env.CRASH_AFTER_STEP,
    });
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "job.completed",
        timestamp: nowTimestamp(),
        optional: { job_id: jobId },
        payload: { result: final },
      }) as BaseEnvelope,
    );
    process.stdout.write(`job_id=${jobId}\n${String(final)}\n`);
  }

  await client.close();
}

void main().catch((e: unknown) => {
  if (e instanceof ARCPError) process.stderr.write(`${e.code}: ${e.message}\n`);
  else throw e;
});
