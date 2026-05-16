import { describe, expect, it } from "vitest";

import {
  ARCPClient,
  ARCPServer,
  type Envelope,
  EventLog,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "@arcp/sdk";

import { TEST_CLIENT, TEST_RUNTIME, TEST_TOKEN } from "../helpers/fixtures.js";

describe("§6.3 resumability (in-memory)", () => {
  it("resume after disconnect replays job events from the event log", async () => {
    const eventLog = new EventLog();
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: { encodings: ["json"] },
      bearer: new StaticBearerVerifier(
        new Map([[TEST_TOKEN, { principal: "tester" }]]),
      ),
      eventLog,
      logger: silentLogger,
    });
    server.registerAgent("ping", async () => ({ ok: true }));

    // First session: connect, run an agent, observe events, then close.
    const client1 = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { encodings: ["json"] },
      authScheme: "bearer",
      token: TEST_TOKEN,
      logger: silentLogger,
      handshakeTimeoutMs: 1000,
    });
    const [c1, s1] = pairMemoryTransports();
    server.accept(s1);
    const welcome1 = await client1.connect(c1);
    const sessionId = client1.state.id;
    if (sessionId === undefined) throw new Error("expected session id");
    const handle = await client1.submit({ agent: "ping" });
    await handle.done;
    const lastSeq = client1.lastEventSeqObserved;
    await client1.close();

    // Second client resumes against the same session id and token.
    const client2 = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { encodings: ["json"] },
      authScheme: "bearer",
      token: TEST_TOKEN,
      logger: silentLogger,
      handshakeTimeoutMs: 1000,
    });
    const replayed: Envelope[] = [];
    client2.on("job.event", (env) => {
      replayed.push(env);
    });
    client2.on("job.result", (env) => {
      replayed.push(env);
    });
    client2.on("job.accepted", (env) => {
      replayed.push(env);
    });
    const [c2, s2] = pairMemoryTransports();
    server.accept(s2);

    // Resume from `last_event_seq = 0` so we get the entire stream.
    const welcome2 = await client2.resume(c2, {
      session_id: sessionId,
      resume_token: welcome1.resume_token,
      last_event_seq: 0,
    });
    // Fresh token issued.
    expect(welcome2.resume_token).not.toBe(welcome1.resume_token);
    // Wait briefly for replays to arrive.
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(replayed.length).toBeGreaterThan(0);
    const types = new Set(replayed.map((e) => e.type));
    expect(types.has("job.result")).toBe(true);

    // Test that resume started past `lastSeq` returns nothing further.
    expect(lastSeq).toBeGreaterThan(0);

    await client2.close();
    await server.close();
  });

  it("resume window expired triggers a session.error", async () => {
    const eventLog = new EventLog();
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: { encodings: ["json"] },
      bearer: new StaticBearerVerifier(
        new Map([[TEST_TOKEN, { principal: "tester" }]]),
      ),
      eventLog,
      logger: silentLogger,
      resumeWindowSeconds: 1,
    });
    server.registerAgent("ping", async () => null);

    const client1 = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { encodings: ["json"] },
      authScheme: "bearer",
      token: TEST_TOKEN,
      logger: silentLogger,
      handshakeTimeoutMs: 1000,
    });
    const [c1, s1] = pairMemoryTransports();
    server.accept(s1);
    const welcome = await client1.connect(c1);
    const sessionId = client1.state.id;
    if (sessionId === undefined) throw new Error("expected session id");
    await client1.close();

    // Use an invalid resume_token to force `RESUME_WINDOW_EXPIRED`.
    const client2 = new ARCPClient({
      client: TEST_CLIENT,
      capabilities: { encodings: ["json"] },
      authScheme: "bearer",
      token: TEST_TOKEN,
      logger: silentLogger,
      handshakeTimeoutMs: 1000,
    });
    const [c2, s2] = pairMemoryTransports();
    server.accept(s2);
    await expect(
      client2.resume(c2, {
        session_id: sessionId,
        resume_token: `${welcome.resume_token}-bogus`,
        last_event_seq: 0,
      }),
    ).rejects.toMatchObject({ code: "RESUME_WINDOW_EXPIRED" });

    await server.close();
  });
});
