/**
 * custom-auth — server.
 *
 * Demonstrates plugging a custom `BearerVerifier` into the runtime. Every
 * inbound `session.hello` carries a bearer token; the verifier resolves
 * that token into a `BearerIdentity` (or throws `UnauthenticatedError`).
 *
 * The verifier here parses a stateless, signed JWT-like token of the form:
 *
 *     <principal>.<expEpoch>.<hmac>
 *
 * with `hmac = HMAC-SHA256(secret, "<principal>.<expEpoch>")`. Replace with
 * a real JWKS verifier, an HTTP call to an auth service, etc.
 *
 * Start:
 *   pnpm tsx examples/custom-auth/server.ts
 *
 * In another terminal:
 *   pnpm tsx examples/custom-auth/client.ts
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ARCPServer,
  type BearerIdentity,
  type BearerVerifier,
  startWebSocketServer,
  UnauthenticatedError,
} from "@arcp/sdk";

const PORT = Number(process.env.ARCP_DEMO_PORT ?? 7894);
const SECRET = process.env.ARCP_DEMO_SECRET ?? "demo-secret";

class SignedTokenVerifier implements BearerVerifier {
  public constructor(private readonly secret: string) {}

  public async verify(token: string): Promise<BearerIdentity> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new UnauthenticatedError("Token format must be principal.exp.sig");
    }
    const [principal, expStr, sig] = parts as [string, string, string];
    const expected = createHmac("sha256", this.secret)
      .update(`${principal}.${expStr}`)
      .digest("hex");
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthenticatedError("Token signature does not verify");
    }
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) {
      throw new UnauthenticatedError("Token has expired");
    }
    return { principal };
  }
}

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { name: "custom-auth-demo", version: "1.0.0" },
    capabilities: { encodings: ["json"], agents: ["echo"] },
    bearer: new SignedTokenVerifier(SECRET),
  });

  server.registerAgent("echo", async (input, _ctx) => ({ echo: input }));

  const wss = await startWebSocketServer({
    host: "127.0.0.1",
    port: PORT,
    onTransport: (t) => {
      server.accept(t);
    },
  });
  console.log(`ARCP runtime listening on ${wss.url}`);
  console.log(`HMAC secret: ${SECRET}`);
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

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
