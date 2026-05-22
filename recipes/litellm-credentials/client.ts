import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const URL = process.env.ARCP_DEMO_URL ?? "ws://127.0.0.1:7893";
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

async function main(): Promise<void> {
  const client = new ARCPClient({
    client: { name: "litellm-credentials-client", version: "1.0.0" },
    capabilities: { encodings: ["json"] },
    authScheme: "bearer",
    token: TOKEN,
  });
  await client.connect(await WebSocketTransport.connect(URL));
  const handle = await client.submit({
    agent: "litellm-chat",
    input: { prompt: "hello" },
    lease: {
      "model.use": ["gpt-4o-mini"],
      "cost.budget": ["USD:0.25"],
    },
    leaseConstraints: {
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    },
  });
  const credential = handle.credentials?.[0];
  process.stdout.write(
    `credential=${credential?.id ?? "none"} endpoint=${credential?.endpoint ?? "none"}\n`,
  );
  await handle.done;
  await client.close();
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
