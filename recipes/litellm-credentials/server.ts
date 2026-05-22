import {
  ARCPServer,
  InMemoryCredentialStore,
  StaticBearerVerifier,
  startWebSocketServer,
  type CredentialIssueContext,
  type CredentialProvisioner,
  type IssuedCredential,
} from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7893);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";
const LITELLM_URL = process.env.LITELLM_URL ?? "http://127.0.0.1:4000";
const ADMIN_KEY = process.env.LITELLM_ADMIN_KEY;

class LiteLLMProvisioner implements CredentialProvisioner {
  public constructor(
    private readonly baseUrl: string,
    private readonly adminKey: string,
  ) {}

  async issue(ctx: CredentialIssueContext): Promise<IssuedCredential[]> {
    const allowedModels = ctx.lease["model.use"] ?? [];
    if (allowedModels.length === 0) return [];
    const maxBudget = parseUsdBudget(ctx.lease["cost.budget"] ?? []);
    const response = await fetch(`${this.baseUrl}/key/generate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.adminKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        allowed_models: allowedModels,
        max_budget: maxBudget,
        duration: ttlSeconds(ctx.leaseConstraints?.expires_at),
      }),
    });
    if (!response.ok) {
      throw new Error(`LiteLLM key generation failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      key: string;
      key_name?: string;
      token?: string;
    };
    const provisionerId = body.key_name ?? body.token ?? `${ctx.jobId}:litellm`;
    return [
      {
        wire: {
          id: `${ctx.jobId}:litellm`,
          scheme: "bearer",
          value: body.key,
          endpoint: `${this.baseUrl}/v1`,
          profile: provisionerId,
          constraints: {
            allowed_models: [...allowedModels],
            ...(maxBudget === undefined
              ? {}
              : { max_spend: { currency: "USD", amount: maxBudget } }),
            ...(ctx.leaseConstraints?.expires_at === undefined
              ? {}
              : { expires_at: ctx.leaseConstraints.expires_at }),
          },
        },
        provisionerId,
      },
    ];
  }

  async revoke(provisionerId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/key/delete`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.adminKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ keys: [provisionerId] }),
    });
    if (!response.ok) {
      throw new Error(`LiteLLM key delete failed: ${response.status}`);
    }
  }
}

function parseUsdBudget(patterns: readonly string[]): number | undefined {
  for (const pattern of patterns) {
    const [currency, amount] = pattern.split(":");
    if (currency === "USD" && amount !== undefined) return Number(amount);
  }
  return undefined;
}

function ttlSeconds(expiresAt: string | undefined): string | undefined {
  if (expiresAt === undefined) return undefined;
  const seconds = Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${seconds}s`;
}

async function main(): Promise<void> {
  if (ADMIN_KEY === undefined || ADMIN_KEY.length === 0) {
    throw new Error("LITELLM_ADMIN_KEY is required");
  }
  const server = new ARCPServer({
    runtime: { name: "litellm-credentials-recipe", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["litellm-chat"] },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    credentialProvisioner: new LiteLLMProvisioner(LITELLM_URL, ADMIN_KEY),
    credentialStore: new InMemoryCredentialStore(),
  });

  server.registerAgent("litellm-chat", async (_input, ctx) => {
    return { modelLease: ctx.lease["model.use"] ?? [] };
  });

  const ws = await startWebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    onTransport: (t) => {
      server.accept(t);
    },
  });
  process.stdout.write(`ARCP server listening on ${ws.url}\n`);
  process.on("SIGINT", () => {
    void ws.close().then(() => server.close());
  });
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
