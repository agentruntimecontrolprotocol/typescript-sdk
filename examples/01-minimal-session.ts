/**
 * Minimal session: open + handshake + close.
 *
 * Spins a runtime in-process, paired with a client over a memory transport.
 * Demonstrates the §8 handshake on the simplest possible auth path.
 */
import {
  ARCPClient,
  ARCPServer,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "../src/index.js";

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { kind: "demo-runtime", version: "0.0.1", trust_level: "trusted" },
    capabilities: { streaming: true },
    bearer: new StaticBearerVerifier(new Map([["secret", { principal: "alice" }]])),
    logger: silentLogger,
  });

  const client = new ARCPClient({
    client: { kind: "demo-client", version: "0.0.1" },
    capabilities: { streaming: true },
    authScheme: "bearer",
    token: "secret",
    logger: silentLogger,
  });

  const [c, s] = pairMemoryTransports();
  server.accept(s);

  process.stdout.write("Connecting...\n");
  const accepted = await client.connect(c);
  process.stdout.write(`Session accepted: ${accepted.session_id}\n`);
  process.stdout.write(`Runtime: ${accepted.runtime.kind} ${accepted.runtime.version}\n`);

  await client.close();
  await server.close();
}

await main();
