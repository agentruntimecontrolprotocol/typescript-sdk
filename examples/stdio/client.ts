/**
 * stdio — client (parent process).
 *
 * Spawns `server.ts` as a child via `pnpm tsx`, wraps the child's
 * stdin/stdout in a StdioTransport, runs the full ARCP handshake +
 * job lifecycle over those pipes, then closes (which terminates the
 * child).
 *
 * Single command:
 *   pnpm tsx examples/stdio/client.ts
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCPClient, StdioTransport, silentLogger } from "@agentruntimecontrolprotocol/sdk";

const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverPath = path.join(here, "server.ts");

  const child = spawn("pnpm", ["tsx", serverPath], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, ARCP_DEMO_TOKEN: TOKEN },
  });

  child.on("error", (err) => {
    process.stderr.write(`[parent] failed to spawn child: ${String(err)}\n`);
    process.exit(1);
  });

  const transport = StdioTransport.fromChild(child);

  const client = new ARCPClient({
    client: { name: "stdio-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
    logger: silentLogger,
  });

  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    process.stdout.write(
      `event[seq=${env.event_seq}] ${env.payload.kind} ${JSON.stringify(env.payload.body)}\n`,
    );
  });

  const welcome = await client.connect(transport);
  process.stdout.write(
    `welcome: session=${client.state.id} runtime=${welcome.runtime.name}\n`,
  );

  const handle = await client.submit({
    agent: "echo",
    input: { message: "hello from the parent" },
  });
  process.stdout.write(`accepted: job_id=${handle.jobId}\n`);

  const result = await handle.done;
  process.stdout.write(`result: ${JSON.stringify(result)}\n`);

  await client.close();

  // The transport close should propagate to the child via EOF on its
  // stdin; nudge it just in case the child is still around.
  if (child.exitCode === null) {
    child.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
  });
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
