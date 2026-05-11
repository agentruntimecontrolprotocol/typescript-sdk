/** Fan a request out to peer runtimes; tolerate partial failure. */
import { randomUUID } from "node:crypto";
import type { BaseEnvelope } from "../../src/index.js";
import { type ARCPClient, buildEnvelope, newMessageId, nowTimestamp } from "../../src/index.js";

import { synthesize } from "./synth.js";

const PEERS = ["research.web", "research.code", "research.docs"];
const TERMINAL = new Set(["job.completed", "job.failed", "job.cancelled"]);

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;

interface Job {
  target: string;
  jobId?: string;
  final?: Record<string, unknown>;
  error?: { code?: unknown; message?: unknown };
}

async function delegate(
  client: ARCPClient,
  args: { target: string; task: string; traceId: string },
): Promise<Job> {
  const accepted = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "agent.delegate",
      timestamp: nowTimestamp(),
      optional: { trace_id: args.traceId },
      payload: {
        target: args.target,
        task: args.task,
        // trace_id propagates so peers join one distributed trace.
        context: { trace_id: args.traceId },
      },
    }) as BaseEnvelope,
    10_000,
  );
  if (accepted.type !== "job.accepted") {
    const p = accepted.payload as { code?: unknown; message?: unknown };
    return { target: args.target, error: { code: p.code, message: p.message } };
  }
  return { target: args.target, jobId: String((accepted.payload as { job_id: string }).job_id) };
}

/**
 * Single reader on the client's event feed; fans out by `job_id`.
 * Without this, parallel listeners starve each other — only one wins per await.
 */
class JobMux {
  private readonly queues = new Map<string, BaseEnvelope[]>();
  private readonly resolvers = new Map<string, ((env: BaseEnvelope | null) => void)[]>();

  public constructor(private readonly client: ARCPClient) {}

  public start(): void {
    const dispatch = (env: BaseEnvelope) => {
      const jid = (env as BaseEnvelope & { job_id?: string }).job_id;
      if (jid === undefined || !this.queues.has(jid)) return;
      const r = this.resolvers.get(jid)?.shift();
      if (r !== undefined) r(env);
      else this.queues.get(jid)?.push(env);
      if (TERMINAL.has(env.type)) {
        const rNull = this.resolvers.get(jid)?.shift();
        if (rNull !== undefined) rNull(null);
        else this.queues.get(jid)?.push(null as unknown as BaseEnvelope);
      }
    };
    for (const t of [
      "job.accepted",
      "job.started",
      "job.progress",
      "job.completed",
      "job.failed",
      "job.cancelled",
      "log",
    ]) {
      this.client.on(t, dispatch);
    }
  }

  public register(jobId: string): void {
    this.queues.set(jobId, []);
    this.resolvers.set(jobId, []);
  }

  public async *stream(job: Job): AsyncIterable<BaseEnvelope> {
    const jobId = job.jobId;
    if (jobId === undefined) return;
    const q = this.queues.get(jobId) ?? [];
    for (;;) {
      let env: BaseEnvelope | null;
      if (q.length > 0) env = q.shift() ?? null;
      else env = await new Promise<BaseEnvelope | null>((r) => this.resolvers.get(jobId)?.push(r));
      if (env === null) return;
      yield env;
      if (TERMINAL.has(env.type)) return;
    }
  }
}

async function collect(mux: JobMux, job: Job): Promise<Job> {
  if (job.error !== undefined) return job;
  for await (const env of mux.stream(job)) {
    if (env.type === "job.completed") {
      job.final = env.payload as Record<string, unknown>;
    } else if (env.type === "job.failed") {
      const p = env.payload as { code?: unknown; message?: unknown };
      job.error = { code: p.code, message: p.message };
    } else if (env.type === "job.cancelled") {
      job.error = { code: "CANCELLED", message: "cancelled" };
    }
  }
  return job;
}

async function main(): Promise<void> {
  const client = null as unknown as ARCPClient; // transport, identity, auth elided

  const mux = new JobMux(client);
  mux.start();

  const reqText = "what changed in our auth stack in the last 30 days?";
  const traceId = `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const jobs: Job[] = [];
  for (const peer of PEERS) {
    const job = await delegate(client, { target: peer, task: reqText, traceId });
    if (job.jobId !== undefined) mux.register(job.jobId);
    jobs.push(job);
  }

  const completed = await Promise.all(jobs.map((j) => collect(mux, j)));
  process.stdout.write(`${synthesize(reqText, completed)}\n`);

  await client.close();
}

void main();
