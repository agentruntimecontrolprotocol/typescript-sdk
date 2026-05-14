/**
 * progress — client.
 *
 * Submits the `indexer` job and renders a simple text progress bar as
 * `progress` events arrive. Re-renders the bar in place on a single
 * stdout line (TTY-friendly).
 */

import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7892/arcp";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

function renderBar(current: number, total: number): string {
  const width = 30;
  const ratio = Math.min(1, current / total);
  const filled = Math.round(width * ratio);
  return `[${"#".repeat(filled)}${".".repeat(width - filled)}] ${current}/${total}`;
}

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "progress-demo-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });

  let updates = 0;
  client.on("job.event", (env) => {
    if (env.type !== "job.event") return;
    if (env.payload.kind !== "progress") return;
    const body = env.payload.body as {
      current: number;
      total?: number;
      units?: string;
      message?: string;
    };
    updates += 1;
    const total = body.total ?? 0;
    const bar = renderBar(body.current, total);
    const units = body.units ?? "";
    const tail = body.message !== undefined ? ` ${body.message}` : "";
    // Overwrite the same line when on a TTY, otherwise print newline.
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${bar} ${units}${tail}   `);
    } else {
      process.stdout.write(`${bar} ${units}${tail}\n`);
    }
  });

  const transport = await WebSocketTransport.connect(URL);
  await client.connect(transport);

  const handle = await client.submit({
    agent: "indexer",
    input: { total: 100, tickMs: 30 },
  });
  process.stdout.write(`accepted job_id=${handle.jobId}\n`);

  const result = await handle.done;
  if (process.stdout.isTTY) process.stdout.write("\n");
  process.stdout.write(
    `result: ${JSON.stringify(result.result)} progress-updates=${updates}\n`,
  );

  await client.close();
}

void main().catch((err) => {
  process.stderr.write(
    `client failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
