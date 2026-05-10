import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ARCPClient, type Envelope, StdioTransport, silentLogger } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME_SCRIPT = resolve(here, "..", "helpers", "stdio-runtime.ts");

async function spawnRuntime(eventLogPath: string): Promise<ChildProcessWithoutNullStreams> {
  const tsxBin = resolve(here, "..", "..", "node_modules", ".bin", "tsx");
  const child = spawn(tsxBin, [RUNTIME_SCRIPT, eventLogPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", () => undefined);
  return child;
}

async function makeClient(child: ChildProcessWithoutNullStreams): Promise<ARCPClient> {
  const client = new ARCPClient({
    client: { kind: "test-client", version: "0.0.1" },
    capabilities: { streaming: true, durable_jobs: true },
    authScheme: "bearer",
    token: "tok-test",
    logger: silentLogger,
    handshakeTimeoutMs: 5000,
  });
  const transport = StdioTransport.fromChild(child);
  await client.connect(transport);
  return client;
}

describe("§19 resumability with child-process kill", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "arcp-resume-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("survives SIGKILL of the runtime: events persist in the event log", async () => {
    const eventLogPath = join(tmp, "events.db");
    const child1 = await spawnRuntime(eventLogPath);
    const client1 = await makeClient(child1);
    const sessionId = client1.state.id;
    if (sessionId === undefined) throw new Error("missing session id");

    // Run a tool to populate the event log.
    const out = await client1.invoke("ping", { hello: "world" });
    expect(out.result.value).toEqual({ echoed: { hello: "world" } });
    await client1.close();

    // Hard-kill the runtime, then start a fresh one against the same DB.
    child1.kill("SIGKILL");
    await new Promise<void>((r) => {
      child1.on("exit", () => r());
    });

    const child2 = await spawnRuntime(eventLogPath);
    const client2 = await makeClient(child2);

    const replays: Envelope[] = [];
    client2.on("tool.result", (e) => {
      replays.push(e);
    });
    client2.on("job.completed", (e) => {
      replays.push(e);
    });
    client2.on("job.accepted", (e) => {
      replays.push(e);
    });
    client2.on("tool.invoke", (e) => {
      replays.push(e);
    });

    await client2.resume({ sessionId });
    await new Promise<void>((r) => setTimeout(r, 200));

    // We expect at least one replayed event from the prior session.
    expect(replays.length).toBeGreaterThan(0);
    expect(replays.some((e) => e.type === "tool.result")).toBe(true);

    await client2.close();
    child2.kill("SIGKILL");
    await new Promise<void>((r) => {
      child2.on("exit", () => r());
    });
  }, 30_000);
});
