import {
  ARCPClient,
  type ARCPClientOptions,
  ARCPServer,
  type ARCPServerOptions,
  type ClientIdentity,
  pairMemoryTransports,
  type RuntimeIdentity,
  StaticBearerVerifier,
  silentLogger,
} from "../../src/index.js";

export const TEST_CLIENT: ClientIdentity = {
  kind: "test-client",
  version: "0.0.1",
  fingerprint: "sha256:test",
  principal: "tester@example.com",
};

export const TEST_RUNTIME: RuntimeIdentity = {
  kind: "test-runtime",
  version: "0.1.0",
  fingerprint: "sha256:server",
  trust_level: "trusted",
};

export const TEST_TOKEN = "tok-allowed";
export const BAD_TOKEN = "tok-rejected";

export function makeBearerVerifier(extra: ReadonlyMap<string, { principal: string }> = new Map()) {
  const tokens = new Map<string, { principal: string }>([
    [TEST_TOKEN, { principal: "tester@example.com" }],
    ...extra.entries(),
  ]);
  return new StaticBearerVerifier(tokens);
}

export interface PairedHarness {
  server: ARCPServer;
  client: ARCPClient;
  /** Drives the handshake and returns when the client has been accepted. */
  connect(): Promise<void>;
  close(): Promise<void>;
}

/** Assemble a runtime + client connected by paired in-memory transports. */
export function makePairedHarness(
  serverOpts: Partial<ARCPServerOptions> = {},
  clientOpts: Partial<ARCPClientOptions> = {},
): PairedHarness {
  const server = new ARCPServer({
    runtime: TEST_RUNTIME,
    capabilities: {
      streaming: true,
      human_input: true,
      anonymous: false,
      ...serverOpts.capabilities,
    },
    bearer: makeBearerVerifier(),
    logger: silentLogger,
    ...serverOpts,
  });
  const client = new ARCPClient({
    client: TEST_CLIENT,
    capabilities: { streaming: true, ...clientOpts.capabilities },
    authScheme: "bearer",
    token: TEST_TOKEN,
    logger: silentLogger,
    handshakeTimeoutMs: 1000,
    ...clientOpts,
  });
  const [clientTransport, serverTransport] = pairMemoryTransports();
  return {
    server,
    client,
    async connect() {
      server.accept(serverTransport);
      await client.connect(clientTransport);
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Wait until `predicate` returns truthy, or the deadline elapses. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 5;
  const deadline = Date.now() + (options.timeoutMs ?? 1000);
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor: predicate never became true");
}
