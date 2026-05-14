/**
 * Delegation example — server.
 *
 * Hosts two agents:
 *   - "build" (parent): runs a fake build, then delegates "test".
 *   - "test"  (child):  runs a fake test suite.
 *
 * Delegation in ARCP v1.0 is a `job.event` of kind "delegate" emitted
 * on the parent's stream. The runtime intercepts it, spawns a child
 * job in the same session, and the child's accept/events/result flow
 * through the same `event_seq` space — interleaved with the parent's.
 *
 * Two invariants enforced by the runtime:
 *   1. The child's `lease_request` MUST be a subset of the parent's
 *      effective lease.
 *   2. The child inherits the parent's `trace_id` so distributed
 *      traces stitch into one tree.
 *
 * Start the server:
 *   pnpm tsx examples/delegate/server.ts
 *
 * In another terminal:
 *   pnpm tsx examples/delegate/client.ts
 */

import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7878);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "delegate-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["build", "test"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
  });

  // Parent agent: simulates a build, then delegates a test suite.
  // The runtime spawns the child job; both event streams interleave
  // in the same session's seq space.
  server.registerAgent("build", async (input, ctx) => {
    const { project } = input as { project: string };

    await ctx.status("compiling");
    await ctx.log("info", `building ${project}`);
    await sleep(50);

    await ctx.status("delegating tests");
    await ctx.delegate({
      delegate_id: "del_tests",
      agent: "test",
      input: { suite: "all" },
      // Subset of the parent's lease: child can read the project
      // tree but can only write into the test-output dir.
      lease_request: {
        "fs.read": [`/workspace/${project}/**`],
        "fs.write": [`/workspace/${project}/test-output/**`],
      },
    });

    await ctx.status("compiled");
    return { project, delegated_tests: true };
  });

  // Child agent: simulates running a test suite. Knows nothing about
  // its parent; just receives input, does work, returns a result.
  server.registerAgent("test", async (input, ctx) => {
    const { suite } = input as { suite: string };

    await ctx.status("running");
    await ctx.log("info", `running ${suite} suite`);
    await sleep(30);
    await ctx.log("info", "127/127 passed");

    return { passed: 127, failed: 0 };
  });

  const wss = await startWebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    onTransport: (t) => {
      server.accept(t);
    },
  });
  console.log(`ARCP runtime listening on ${wss.url}`);
  console.log(`Token: ${TOKEN}`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (): Promise<void> => {
    console.log("\nshutting down...");
    await wss.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
