/**
 * cost-budget — client.
 *
 * Submits a `web-research` job with a USD 1.00 budget; the agent
 * charges 0.30 per iteration. After ~4 iterations the next pre-call
 * authorization throws `BUDGET_EXHAUSTED`. The runtime debounces
 * `cost.budget.remaining` metrics so we can observe the trajectory.
 */

import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7891/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "cost-budget-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    const k = env.payload.kind;
    if (k === "metric") {
      const m = env.payload.body as {
        name: string;
        value: number;
        unit?: string;
      };
      if (m.name === "cost.budget.remaining" || m.name === "cost.search") {
        process.stdout.write(
          `metric[seq=${env.event_seq}] ${m.name}=${m.value.toFixed(2)} ${m.unit ?? ""}\n`,
        );
      }
    } else if (k === "tool_result") {
      const body = env.payload.body as {
        call_id: string;
        error?: { code: string; message: string };
      };
      if (body.error !== undefined) {
        process.stdout.write(
          `tool_result error[seq=${env.event_seq}] call_id=${body.call_id} code=${body.error.code}\n`,
        );
      }
    }
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  try {
    const handle = await client.submit({
      agent: "web-research",
      input: { iterations: 8, perCallUSD: 0.3 },
      lease: {
        "tool.call": ["search.*", "fetch.*"],
        "cost.budget": ["USD:1.00"],
      },
    });
    process.stdout.write(
      `accepted job_id=${handle.jobId} initial_budget=${JSON.stringify(handle.budget)}\n`,
    );
    await handle.done;
    throw new Error("expected BUDGET_EXHAUSTED");
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "BUDGET_EXHAUSTED") {
      process.stdout.write(`job.error code=${e.code} message="${e.message}"\n`);
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
