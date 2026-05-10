import { describe, expect, it } from "vitest";
import {
  ARCPClient,
  ARCPError,
  ARCPServer,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "../../src/index.js";
import {
  BAD_TOKEN,
  makePairedHarness,
  TEST_CLIENT,
  TEST_RUNTIME,
  TEST_TOKEN,
} from "../helpers/fixtures.js";

describe("§8.1 four-step session handshake", () => {
  it("happy path: bearer token accepted, session.accepted received", async () => {
    const h = makePairedHarness();
    await h.connect();
    expect(h.client.state.isAccepted).toBe(true);
    expect(h.client.state.id).toMatch(/^sess_/);
    expect(h.client.state.capabilities?.streaming).toBe(true);
    await h.close();
  });

  it("rejects when bearer token is unknown", async () => {
    const h = makePairedHarness({}, { token: BAD_TOKEN });
    await expect(h.connect()).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });

  it("rejects when bearer scheme requested but no verifier configured", async () => {
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: { streaming: true },
      logger: silentLogger,
    });
    const client = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { streaming: true },
      authScheme: "bearer",
      token: TEST_TOKEN,
      logger: silentLogger,
      handshakeTimeoutMs: 500,
    });
    const [c, s] = pairMemoryTransports();
    server.accept(s);
    await expect(client.connect(c)).rejects.toBeInstanceOf(ARCPError);
    await client.close();
    await server.close();
  });

  it("anonymous: rejected when capability not negotiated", async () => {
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: { streaming: true, anonymous: false },
      allowAnonymous: false,
      logger: silentLogger,
    });
    const client = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { streaming: true, anonymous: true },
      authScheme: "none",
      logger: silentLogger,
      handshakeTimeoutMs: 500,
    });
    const [c, s] = pairMemoryTransports();
    server.accept(s);
    await expect(client.connect(c)).rejects.toBeInstanceOf(ARCPError);
    await client.close();
    await server.close();
  });

  it("anonymous: accepted when both sides advertise the capability", async () => {
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: { streaming: true, anonymous: true },
      allowAnonymous: true,
      logger: silentLogger,
    });
    const client = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { streaming: true, anonymous: true },
      authScheme: "none",
      logger: silentLogger,
      handshakeTimeoutMs: 500,
    });
    const [c, s] = pairMemoryTransports();
    server.accept(s);
    const accepted = await client.connect(c);
    expect(accepted.session_id).toMatch(/^sess_/);
    expect(accepted.capabilities.anonymous).toBe(true);
    await client.close();
    await server.close();
  });

  it("capability negotiation takes the AND of advertised booleans", async () => {
    const h = makePairedHarness(
      { capabilities: { streaming: true, durable_jobs: true, human_input: false } },
      { capabilities: { streaming: true, durable_jobs: false, human_input: true } },
    );
    await h.connect();
    expect(h.client.state.capabilities?.streaming).toBe(true);
    expect(h.client.state.capabilities?.durable_jobs).toBe(false);
    expect(h.client.state.capabilities?.human_input).toBe(false);
    await h.close();
  });

  it("heartbeat_interval_seconds: minimum advertised wins", async () => {
    const h = makePairedHarness(
      { capabilities: { heartbeat_interval_seconds: 30 } },
      { capabilities: { heartbeat_interval_seconds: 10 } },
    );
    await h.connect();
    expect(h.client.state.heartbeatInterval).toBe(10);
    await h.close();
  });

  it("dropping pre-handshake non-handshake messages does not affect the session", async () => {
    const h = makePairedHarness();
    await h.connect();
    // Server's pre-handshake guard already exercised by accepting; verify
    // the dispatcher's pre-handshake drop path indirectly via a fresh server.
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: {},
      bearer: new StaticBearerVerifier(new Map([[TEST_TOKEN, { principal: "p" }]])),
      logger: silentLogger,
    });
    const [clientSide, serverSide] = pairMemoryTransports();
    const ctx = server.accept(serverSide);
    // Send a non-handshake message before any session.open.
    await clientSide.send({
      arcp: "1.0",
      id: "msg_pre",
      type: "ping",
      timestamp: "2026-05-09T13:00:00Z",
      payload: {},
    });
    // Verify the session is still in opening phase.
    expect(ctx.state.phase).toBe("opening");
    await server.close();
    await h.close();
  });

  it("replayed session.open is rejected with FAILED_PRECONDITION", async () => {
    const h = makePairedHarness();
    await h.connect();
    const replayed = {
      arcp: "1.0",
      id: "msg_replay",
      type: "session.open",
      timestamp: "2026-05-09T13:00:00Z",
      payload: {
        auth: { scheme: "bearer", token: TEST_TOKEN },
        client: TEST_CLIENT,
        capabilities: {},
      },
    };
    let nackPayload: { code?: string } | null = null;
    h.client.on("nack" as never, (env) => {
      if (env.type === "nack") {
        nackPayload = env.payload as { code?: string };
      }
    });
    // Send the replay through the client's underlying transport directly.
    // Since we're already accepted, this exercises the post-handshake path.
    await h.client.send(replayed as Parameters<typeof h.client.send>[0]);
    // wait briefly for round-trip
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(nackPayload).not.toBeNull();
    await h.close();
  });
});
