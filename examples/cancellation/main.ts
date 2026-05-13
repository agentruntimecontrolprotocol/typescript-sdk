/** Two scenarios over the §10.4 / §10.5 control surface. */

import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  buildEnvelope,
  FailedPreconditionError,
  newMessageId,
  nowTimestamp,
} from "../../src/index.js";

const CANCEL_DEADLINE_MS = 5_000;

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;
declare function events(client: ARCPClient): AsyncIterable<BaseEnvelope>;

async function startLongJob(client: ARCPClient): Promise<string> {
  const accepted = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "tool.invoke",
      timestamp: nowTimestamp(),
      payload: { tool: "demo.long_running", arguments: { work_seconds: 600 } },
    }) as BaseEnvelope,
    10_000,
  );
  return String((accepted.payload as { job_id: string }).job_id);
}

async function cancelJob(
  client: ARCPClient,
  args: { jobId: string; reason: string; deadlineMs: number },
): Promise<BaseEnvelope> {
  // Cooperative cancel. Runtime drives target to a clean checkpoint
  // inside `deadline_ms` before terminating; escalates to ABORTED on
  // timeout (RFC §10.4).
  const reply = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "cancel",
      timestamp: nowTimestamp(),
      payload: {
        target: "job",
        target_id: args.jobId,
        reason: args.reason,
        deadline_ms: args.deadlineMs,
      },
    }) as BaseEnvelope,
    args.deadlineMs + 5000,
  );
  if (reply.type === "cancel.refused") {
    throw new FailedPreconditionError(
      String((reply.payload as { reason?: string }).reason ?? "cancel refused"),
    );
  }
  return reply;
}

async function interruptJob(
  client: ARCPClient,
  args: { jobId: string; prompt: string },
): Promise<void> {
  // Distinct from cancel: pauses the job (`blocked`), runtime emits
  // `human.input.request`. Job is NOT terminated (RFC §10.5).
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "interrupt",
      timestamp: nowTimestamp(),
      payload: { target: "job", target_id: args.jobId, prompt: args.prompt },
    }) as BaseEnvelope,
  );
}

async function awaitTerminal(client: ARCPClient, args: { jobId: string }): Promise<BaseEnvelope> {
  for await (const env of events(client)) {
    if ((env as BaseEnvelope & { job_id?: string }).job_id !== args.jobId) continue;
    if (["job.completed", "job.failed", "job.cancelled"].includes(env.type)) return env;
  }
  throw new Error("event stream closed before terminal");
}

async function scenarioCancel(): Promise<void> {
  const client = null as unknown as ARCPClient; // transport, identity, auth elided
  try {
    const jobId = await startLongJob(client);
    await new Promise((r) => setTimeout(r, 2000)); // let the job actually start
    const ack = await cancelJob(client, {
      jobId,
      reason: "user_aborted",
      deadlineMs: CANCEL_DEADLINE_MS,
    });
    process.stdout.write(`cancel ack: ${ack.type}\n`);
    const terminal = await awaitTerminal(client, { jobId });
    process.stdout.write(
      `terminal: ${terminal.type} code=${(terminal.payload as { code?: string }).code}\n`,
    );
  } finally {
    await client.close();
  }
}

async function scenarioInterrupt(): Promise<void> {
  const client = null as unknown as ARCPClient;
  try {
    const jobId = await startLongJob(client);
    await new Promise((r) => setTimeout(r, 2000));
    await interruptJob(client, {
      jobId,
      prompt: "Pause and ask before touching production tables.",
    });
    // Runtime now emits human.input.request; answer via examples/human_input.
    for await (const env of events(client)) {
      if (
        env.type === "human.input.request" &&
        (env as BaseEnvelope & { job_id?: string }).job_id === jobId
      ) {
        process.stdout.write(
          `awaiting human: ${JSON.stringify((env.payload as { prompt?: string }).prompt)}\n`,
        );
        return;
      }
    }
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const which = process.argv[2] ?? "cancel";
  if (which === "cancel") await scenarioCancel();
  else if (which === "interrupt") await scenarioInterrupt();
  else throw new Error(`unknown scenario: ${which}`);
}

void main();
