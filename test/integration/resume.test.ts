import { describe, expect, it } from "vitest";
import {
  ARCPClient,
  ARCPServer,
  type Envelope,
  EventLog,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "../../src/index.js";
import { TEST_CLIENT, TEST_RUNTIME, TEST_TOKEN } from "../helpers/fixtures.js";

describe("§19 resumability (in-memory)", () => {
  it("resume after disconnect replays envelopes from the event log", async () => {
    const eventLog = new EventLog();
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: { streaming: true, durable_jobs: true },
      bearer: new StaticBearerVerifier(new Map([[TEST_TOKEN, { principal: "tester" }]])),
      eventLog,
      logger: silentLogger,
    });
    server.registerTool("ping", async () => ({ ok: true }));

    // First session: connect, run a tool, observe envelopes.
    const client1 = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { streaming: true },
      authScheme: "bearer",
      token: TEST_TOKEN,
      logger: silentLogger,
      handshakeTimeoutMs: 1000,
    });
    const [c1, s1] = pairMemoryTransports();
    server.accept(s1);
    const accepted = await client1.connect(c1);
    const sessionId = accepted.session_id;
    await client1.invoke("ping", {});
    await client1.close();

    // Second client reconnects against the SAME server (and SAME event log).
    const client2 = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { streaming: true },
      authScheme: "bearer",
      token: TEST_TOKEN,
      logger: silentLogger,
      handshakeTimeoutMs: 1000,
    });
    const replayed: Envelope[] = [];
    client2.on("job.completed", (env) => {
      replayed.push(env);
    });
    client2.on("tool.result", (env) => {
      replayed.push(env);
    });
    client2.on("job.accepted", (env) => {
      replayed.push(env);
    });
    const [c2, s2] = pairMemoryTransports();
    server.accept(s2);
    await client2.connect(c2);

    // Issue a resume scoped to the FIRST session_id; runtime replays its log.
    await client2.resume({ sessionId });
    // Wait briefly for replays to arrive.
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(replayed.length).toBeGreaterThan(0);
    const types = replayed.map((e) => e.type);
    expect(types).toContain("tool.result");

    await client2.close();
    await server.close();
  });

  it("resume with no after_message_id returns the entire session log", async () => {
    const eventLog = new EventLog();
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: {},
      bearer: new StaticBearerVerifier(new Map([[TEST_TOKEN, { principal: "tester" }]])),
      eventLog,
      logger: silentLogger,
    });
    server.registerTool("count", async (_args, ctx) => {
      await ctx.emitProgress({ percent: 50 });
      return null;
    });
    const client = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: {},
      authScheme: "bearer",
      token: TEST_TOKEN,
      logger: silentLogger,
      handshakeTimeoutMs: 1000,
    });
    const [c, s] = pairMemoryTransports();
    server.accept(s);
    const accepted = await client.connect(c);
    await client.invoke("count", {});
    const replays: Envelope[] = [];
    client.on("job.progress", (e) => {
      replays.push(e);
    });
    await client.resume({ sessionId: accepted.session_id });
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(replays.some((e) => e.type === "job.progress")).toBe(true);
    await client.close();
    await server.close();
  });
});
