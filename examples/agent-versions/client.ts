/**
 * agent-versions — client.
 *
 * Submits three jobs back-to-back:
 *   1. bare `code-refactor`        → resolves to the default (2.0.0).
 *   2. pinned `code-refactor@1.0.0` → resolves to the v1 handler.
 *   3. pinned `code-refactor@3.0.0` → rejects with
 *      `AGENT_VERSION_NOT_AVAILABLE` (no such version registered).
 */

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7889/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "agent-versions-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  // 1) bare name → default version
  const a = await client.submit({
    agent: "code-refactor",
    input: { path: "x.ts" },
  });
  process.stdout.write(`bare → handle.agent=${a.agent}\n`);
  const ar = await a.done;
  process.stdout.write(`bare result: ${JSON.stringify(ar.result)}\n`);

  // 2) pinned 1.0.0
  const b = await client.submit({
    agent: "code-refactor@1.0.0",
    input: { path: "x.ts" },
  });
  process.stdout.write(`pinned@1.0.0 → handle.agent=${b.agent}\n`);
  const br = await b.done;
  process.stdout.write(`v1 result: ${JSON.stringify(br.result)}\n`);

  // 3) pinned 3.0.0 — unregistered version
  try {
    await client.submit({
      agent: "code-refactor@3.0.0",
      input: { path: "x.ts" },
    });
    throw new Error("expected AGENT_VERSION_NOT_AVAILABLE");
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "AGENT_VERSION_NOT_AVAILABLE") {
      process.stdout.write(
        `pinned@3.0.0 → error code=${e.code} message="${e.message}"\n`,
      );
    } else {
      throw err;
    }
  }

  await client.close();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
