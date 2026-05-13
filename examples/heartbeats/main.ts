/** Supervisor + worker pool. Heartbeat loss reroutes via idempotency_key. */
import { randomUUID } from "node:crypto";
import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  buildEnvelope,
  newJobId,
  newMessageId,
  nowTimestamp,
  safeSetInterval,
} from "../../src/index.js";

import { doWork } from "./work.js";

const HEARTBEAT_INTERVAL_SECONDS = 15;
const DEADLINE_S = HEARTBEAT_INTERVAL_SECONDS * 2; // RFC §10.3 default N=2

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;

interface Worker {
  workerId: string;
  role: string;
  lastHeartbeat: Date;
  inFlightJob?: string;
}

interface Task {
  taskId: string;
  role: string;
  payload: Record<string, unknown>;
  idempotencyKey: string; // safety net for re-dispatch
}

class Roster {
  public readonly workers = new Map<string, Worker>();
  public readonly byRole = new Map<string, string[]>();

  public add(w: Worker): void {
    this.workers.set(w.workerId, w);
    const list = this.byRole.get(w.role) ?? [];
    list.push(w.workerId);
    this.byRole.set(w.role, list);
  }

  public candidates(role: string): Worker[] {
    return (this.byRole.get(role) ?? [])
      .map((id) => this.workers.get(id))
      .filter((w): w is Worker => w !== undefined && w.inFlightJob === undefined);
  }
}

// Supervisor side --------------------------------------------------------

async function dispatch(
  client: ARCPClient,
  args: { task: Task; roster: Roster; jobsToTasks: Map<string, Task> },
): Promise<void> {
  const candidates = args.roster.candidates(args.task.role);
  if (candidates.length === 0) throw new Error(`no idle workers for role=${args.task.role}`);
  const worker = candidates.reduce((a, b) => (a.lastHeartbeat < b.lastHeartbeat ? a : b));
  // Same idempotency_key on every re-dispatch (RFC §6.4): a worker
  // that survived the network blip dedupes; it doesn't re-execute.
  const accepted = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "agent.delegate",
      timestamp: nowTimestamp(),
      optional: { idempotency_key: args.task.idempotencyKey },
      payload: {
        target: worker.workerId,
        task: args.task.taskId,
        context: { task_payload: args.task.payload },
      },
    }) as BaseEnvelope,
    10_000,
  );
  const jobId = String((accepted.payload as { job_id: string }).job_id);
  worker.inFlightJob = jobId;
  args.jobsToTasks.set(jobId, args.task);
}

function supervise(client: ARCPClient, roster: Roster, jobsToTasks: Map<string, Task>): void {
  // Drain inbound + reap stale workers.
  safeSetInterval(async () => {
    const now = Date.now();
    for (const w of [...roster.workers.values()]) {
      if (now - w.lastHeartbeat.getTime() <= DEADLINE_S * 1000) continue;
      const jid = w.inFlightJob;
      const task = jid !== undefined ? jobsToTasks.get(jid) : undefined;
      if (jid !== undefined && task !== undefined) {
        jobsToTasks.delete(jid);
        await dispatch(client, { task, roster, jobsToTasks });
      }
      roster.workers.delete(w.workerId);
      const list = roster.byRole.get(w.role) ?? [];
      roster.byRole.set(
        w.role,
        list.filter((id) => id !== w.workerId),
      );
    }
  }, HEARTBEAT_INTERVAL_SECONDS * 1000);

  client.on("job.heartbeat", (env) => {
    const jid = (env as BaseEnvelope & { job_id?: string }).job_id;
    for (const w of roster.workers.values()) {
      if (w.inFlightJob === jid) w.lastHeartbeat = new Date();
    }
  });
  for (const t of ["job.completed", "job.failed", "job.cancelled"]) {
    client.on(t, (env) => {
      const jid = (env as BaseEnvelope & { job_id?: string }).job_id ?? "";
      jobsToTasks.delete(jid);
      for (const w of roster.workers.values()) {
        if (w.inFlightJob === jid) delete w.inFlightJob;
      }
    });
  }
}

// Worker side ------------------------------------------------------------

async function heartbeatLoop(
  client: ARCPClient,
  args: { jobId: string; stop: { value: boolean } },
): Promise<void> {
  let seq = 0;
  while (!args.stop.value) {
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "job.heartbeat",
        timestamp: nowTimestamp(),
        optional: { job_id: args.jobId },
        payload: {
          sequence: seq,
          deadline_ms: HEARTBEAT_INTERVAL_SECONDS * 2000,
          state: "running",
        },
      }) as BaseEnvelope,
    );
    seq += 1;
    await new Promise((r) => setTimeout(r, HEARTBEAT_INTERVAL_SECONDS * 1000));
  }
}

async function execute(client: ARCPClient, env: BaseEnvelope): Promise<void> {
  const jobId = newJobId();
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "job.accepted",
      timestamp: nowTimestamp(),
      optional: { job_id: jobId, correlation_id: env.id },
      payload: { job_id: jobId, state: "accepted" },
    }) as BaseEnvelope,
  );
  await client.send(
    buildEnvelope({
      id: newMessageId(),
      type: "job.started",
      timestamp: nowTimestamp(),
      optional: { job_id: jobId },
      payload: { job_id: jobId },
    }) as BaseEnvelope,
  );
  const stop = { value: false };
  const hb = heartbeatLoop(client, { jobId, stop });
  try {
    const ctx = (env.payload as { context?: { task_payload?: Record<string, unknown> } }).context;
    const result = await doWork(ctx?.task_payload ?? {});
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "job.completed",
        timestamp: nowTimestamp(),
        optional: { job_id: jobId },
        payload: { result },
      }) as BaseEnvelope,
    );
  } catch (exc) {
    await client.send(
      buildEnvelope({
        id: newMessageId(),
        type: "job.failed",
        timestamp: nowTimestamp(),
        optional: { job_id: jobId },
        payload: { code: "INTERNAL", message: String(exc), retryable: true },
      }) as BaseEnvelope,
    );
  } finally {
    stop.value = true;
    await hb;
  }
}

function runWorker(client: ARCPClient): void {
  client.on("agent.delegate", (env) => execute(client, env));
}

async function main(): Promise<void> {
  const supervisor = null as unknown as ARCPClient; // privileged supervisor
  const roster = new Roster();
  const jobsToTasks = new Map<string, Task>();

  // In production each worker is its own process; co-hosted here for the demo.
  for (const role of ["indexer", "extractor", "archiver"]) {
    for (let i = 0; i < 2; i++) {
      const w = null as unknown as ARCPClient; // worker session, capabilities advertise role
      runWorker(w);
      roster.add({
        workerId: `${role}-${randomUUID().slice(0, 6)}`,
        role,
        lastHeartbeat: new Date(),
      });
    }
  }

  supervise(supervisor, roster, jobsToTasks);

  for (let n = 0; n < 6; n++) {
    const role = ["indexer", "extractor", "archiver"][n % 3] ?? "indexer";
    await dispatch(supervisor, {
      task: {
        taskId: `t${String(n).padStart(3, "0")}`,
        role,
        payload: { shard: n },
        idempotencyKey: `openclaw:t${String(n).padStart(3, "0")}`,
      },
      roster,
      jobsToTasks,
    });
  }

  await new Promise((r) => setTimeout(r, 60_000));
  await supervisor.close();
}

void main();
