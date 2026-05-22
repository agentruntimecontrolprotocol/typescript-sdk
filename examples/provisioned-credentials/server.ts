import {
  ARCPServer,
  InMemoryCredentialStore,
  StaticBearerVerifier,
  startWebSocketServer,
  type CredentialIssueContext,
  type CredentialProvisioner,
  type IssuedCredential,
} from "@agentruntimecontrolprotocol/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7892);
const TOKEN = process.env.ARCP_DEMO_TOKEN ?? "demo-token";

class MockProvisioner implements CredentialProvisioner {
  public readonly revoked: string[] = [];

  async issue(ctx: CredentialIssueContext): Promise<IssuedCredential[]> {
    const models = ctx.lease["model.use"] ?? [];
    if (models.length === 0) return [];
    const id = `${ctx.jobId}:mock-llm`;
    return [
      {
        wire: {
          id,
          scheme: "bearer",
          value: `mock-key-${ctx.jobId}`,
          endpoint: "http://localhost/mock-llm/v1",
          constraints: {
            allowed_models: [...models],
            ...(ctx.leaseConstraints?.expires_at === undefined
              ? {}
              : { expires_at: ctx.leaseConstraints.expires_at }),
          },
        },
        provisionerId: id,
      },
    ];
  }

  async revoke(provisionerId: string): Promise<void> {
    this.revoked.push(provisionerId);
    process.stdout.write(`revoked ${provisionerId}\n`);
  }
}

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "provisioned-credentials-demo", version: "1.0.0" },
    capabilities: {
      encodings: ["json"],
      agents: ["ask-model"],
    },
    bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
    credentialProvisioner: new MockProvisioner(),
    credentialStore: new InMemoryCredentialStore(),
  });

  server.registerAgent("ask-model", async (_input, ctx) => {
    return {
      modelLease: ctx.lease["model.use"] ?? [],
    };
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
