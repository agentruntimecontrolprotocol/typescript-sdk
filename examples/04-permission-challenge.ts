/**
 * Permission challenge with lease grant.
 *
 * Tool requests a write lease on a resource. The client's
 * PermissionDecisionHandler grants it. Tool proceeds.
 */
import {
  ARCPClient,
  ARCPServer,
  type PermissionDecisionHandler,
  type PermissionGrantPayload,
  type PermissionRequestPayload,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "../src/index.js";

class GrantingHandler implements PermissionDecisionHandler {
  public async decide(
    payload: PermissionRequestPayload,
  ): Promise<{ kind: "grant"; grant: PermissionGrantPayload }> {
    process.stdout.write(
      `[policy] granting ${payload.permission} on ${payload.resource} for ${payload.requested_lease_seconds ?? 60}s\n`,
    );
    return {
      kind: "grant",
      grant: {
        lease_id: "demo-lease-001",
        permission: payload.permission,
        resource: payload.resource,
        operation: payload.operation,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    };
  }
}

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { kind: "demo-runtime", version: "0.0.1" },
    capabilities: { streaming: true },
    bearer: new StaticBearerVerifier(new Map([["t", { principal: "demo" }]])),
    logger: silentLogger,
  });

  server.registerTool("write-config", async (_args, ctx) => {
    const granted = await ctx.requestPermission({
      permission: "filesystem.write",
      resource: "/tmp/demo.json",
      operation: "write",
      reason: "save updated configuration",
      requested_lease_seconds: 60,
    });
    process.stdout.write(`[tool] received lease ${granted.lease_id}\n`);
    return { wrote: "/tmp/demo.json" };
  });

  const client = new ARCPClient({
    client: { kind: "demo-client", version: "0.0.1" },
    capabilities: { streaming: true },
    authScheme: "bearer",
    token: "t",
    permissionHandler: new GrantingHandler(),
    logger: silentLogger,
  });

  const [c, s] = pairMemoryTransports();
  server.accept(s);
  await client.connect(c);

  const out = await client.invoke("write-config", {});
  process.stdout.write(`Tool returned: ${JSON.stringify(out.result.value)}\n`);

  await client.close();
  await server.close();
}

await main();
