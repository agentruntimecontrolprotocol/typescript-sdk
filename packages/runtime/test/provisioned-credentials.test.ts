/**
 * Tests for ARCP v1.1 §9.7–§9.8 — Provisioned credentials.
 *
 * Coverage:
 *   1. InMemoryCredentialStore — unit behaviour
 *   2. ARCPServer constructor guard (§14 — Credential revocation reliability)
 *   3. advertisedFeatures — feature flag gating when no provisioner configured
 *   4. Full mint → job.accepted → job.done → revoke lifecycle (E2E via memory transport)
 *   5. Credential confidentiality: non-submitter subscriber never receives credentials (§14)
 */

import {
  BudgetExhaustedError,
  PROTOCOL_VERSION,
  silentLogger,
  StaticBearerVerifier,
  pairMemoryTransports,
} from "@agentruntimecontrolprotocol/core";
import { describe, expect, it, vi } from "vitest";

import type {
  CredentialProvisioner,
  IssuedCredential,
} from "../src/credential-provisioner.js";
import { toBudgetExhausted } from "../src/credential-provisioner.js";
import { InMemoryCredentialStore } from "../src/credential-store.js";
import { ARCPServer } from "../src/server.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_RUNTIME = { name: "test-runtime", version: "0.0.1" } as const;
const TEST_CAPABILITIES = { encodings: ["json"] };

/** A minimal Credential wire value (§9.7 wire shape). */
function makeWireCredential(id: string): IssuedCredential["wire"] {
  return {
    id,
    scheme: "bearer",
    // SECURITY: this is a fake test value; the real value would be a JWT or
    // API key and must never appear in logs. In tests we use an opaque string.
    value: `fake-token-${id}`,
    endpoint: "https://llm.example.test/v1",
    constraints: {
      allowed_models: ["gpt-4*"],
      max_spend: { currency: "USD", amount: 1 },
    },
  };
}

/** Build an `IssuedCredential` (wire + provisionerId). */
function makeIssuedCredential(id: string): IssuedCredential {
  return {
    wire: makeWireCredential(id),
    provisionerId: `prov-${id}`,
  };
}

/** A no-op provisioner that issues one credential per call. */
function makeProvisioner(
  creds: IssuedCredential[] = [makeIssuedCredential("cred-1")],
): CredentialProvisioner {
  return {
    issue: vi.fn().mockResolvedValue(creds),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
}

/** Build a `session.hello` frame with a bearer token. */
function helloFrame(token: string): Record<string, unknown> {
  return {
    arcp: PROTOCOL_VERSION,
    id: "msg-hello",
    type: "session.hello",
    payload: {
      client: { name: "test-client", version: "0.0.1" },
      // Advertise all features that may be exercised in E2E tests so that
      // intersectFeatures(server, client) is non-empty and feature-gated
      // handlers (subscribe, provisioned_credentials) are reachable.
      capabilities: {
        encodings: ["json"],
        features: ["subscribe", "provisioned_credentials", "model.use"],
      },
      auth: { scheme: "bearer", token },
    },
  };
}

/**
 * Build a `job.submit` frame.
 *
 * `sessionId` is REQUIRED — `RoundTripEnvelopeSchema` (§5.1) enforces that
 * every non-handshake envelope carries `session_id`.  The server assigns the
 * session ID in the `session.welcome` envelope; callers must extract it from
 * that frame (at the envelope level: `frame["session_id"]`) and pass it here.
 */
function submitFrame(
  agent: string,
  sessionId: string,
): Record<string, unknown> {
  return {
    arcp: PROTOCOL_VERSION,
    id: "msg-submit",
    type: "job.submit",
    session_id: sessionId,
    payload: {
      agent,
      input: { hello: "world" },
    },
  };
}

/**
 * FrameCollector — registers a single `onFrame` handler on a MemoryTransport
 * and buffers every frame it receives.  Multiple callers can then call
 * `waitFor(predicate)` independently without triggering the
 * "MemoryTransport already has a frame handler" guard.
 */
class FrameCollector {
  private readonly _collected: Record<string, unknown>[] = [];
  private readonly _waiters: {
    predicate: (frame: Record<string, unknown>) => boolean;
    resolve: (frames: Record<string, unknown>[]) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  constructor(transport: ReturnType<typeof pairMemoryTransports>[0]) {
    // Called ONCE per transport instance — satisfies the single-handler
    // constraint enforced by MemoryTransport.
    transport.onFrame((frame) => {
      const f = frame as Record<string, unknown>;
      this._collected.push(f);
      // Notify any waiters whose predicate is now satisfied.
      for (let i = this._waiters.length - 1; i >= 0; i--) {
        const waiter = this._waiters[i]!;
        if (waiter.predicate(f)) {
          clearTimeout(waiter.timer);
          this._waiters.splice(i, 1);
          waiter.resolve([...this._collected]);
        }
      }
    });
  }

  /**
   * Resolve with a snapshot of all collected frames once a frame satisfying
   * `predicate` has been received (or has already been received).
   */
  waitFor(
    predicate: (frame: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>[]> {
    // Already satisfied by a previously-buffered frame.
    if (this._collected.some(predicate)) {
      return Promise.resolve([...this._collected]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.findIndex((w) => w.timer === timer);
        if (idx !== -1) this._waiters.splice(idx, 1);
        reject(
          new Error(
            `FrameCollector timed out after ${timeoutMs} ms; collected types: ${JSON.stringify(this._collected.map((f) => f["type"]))}`,
          ),
        );
      }, timeoutMs);
      this._waiters.push({ predicate, resolve, reject, timer });
    });
  }
}

// ---------------------------------------------------------------------------
// 1. InMemoryCredentialStore — unit behaviour
// ---------------------------------------------------------------------------

describe("InMemoryCredentialStore", () => {
  it("add then removeByJob returns the entry and empties the slot", async () => {
    const store = new InMemoryCredentialStore();
    await store.add({
      jobId: "job-1",
      credentialId: "cred-1",
      provisionerId: "prov-1",
      issuedAt: new Date().toISOString(),
    });
    const removed = await store.removeByJob("job-1");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.credentialId).toBe("cred-1");

    // Second removal returns empty.
    const second = await store.removeByJob("job-1");
    expect(second).toHaveLength(0);
  });

  it("listOutstanding returns all un-removed entries across multiple jobs", async () => {
    const store = new InMemoryCredentialStore();
    const now = new Date().toISOString();
    await store.add({
      jobId: "job-a",
      credentialId: "c-1",
      provisionerId: "p-1",
      issuedAt: now,
    });
    await store.add({
      jobId: "job-a",
      credentialId: "c-2",
      provisionerId: "p-2",
      issuedAt: now,
    });
    await store.add({
      jobId: "job-b",
      credentialId: "c-3",
      provisionerId: "p-3",
      issuedAt: now,
    });

    const all = await store.listOutstanding();
    expect(all).toHaveLength(3);
    const ids = new Set(all.map((e) => e.credentialId));
    expect(ids).toEqual(new Set(["c-1", "c-2", "c-3"]));

    // Remove job-a; job-b remains.
    await store.removeByJob("job-a");
    const remaining = await store.listOutstanding();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.jobId).toBe("job-b");
  });

  it("removeByJob for an unknown job returns an empty array", async () => {
    const store = new InMemoryCredentialStore();
    const result = await store.removeByJob("nonexistent");
    expect(result).toEqual([]);
  });
});

describe("toBudgetExhausted", () => {
  it("throws a non-retryable BUDGET_EXHAUSTED error", () => {
    expect(() => {
      toBudgetExhausted(new Error("upstream 402"), { vendor: "test" });
    }).toThrow(BudgetExhaustedError);

    try {
      toBudgetExhausted(new Error("upstream 402"), { vendor: "test" });
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExhaustedError);
      const err = error as BudgetExhaustedError;
      expect(err.code).toBe("BUDGET_EXHAUSTED");
      expect(err.retryable).toBe(false);
      expect(err.details).toEqual({ vendor: "test" });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. ARCPServer constructor guard
// ---------------------------------------------------------------------------

describe("ARCPServer constructor guard (§14 — Credential revocation reliability)", () => {
  it("throws TypeError when credentialProvisioner is set without credentialStore", () => {
    expect(() => {
      new ARCPServer({
        runtime: TEST_RUNTIME,
        capabilities: TEST_CAPABILITIES,
        credentialProvisioner: makeProvisioner(),
        // credentialStore intentionally omitted
      });
    }).toThrow(TypeError);
  });

  it("throws with an informative message mentioning credentialStore and §14", () => {
    expect(() => {
      new ARCPServer({
        runtime: TEST_RUNTIME,
        capabilities: TEST_CAPABILITIES,
        credentialProvisioner: makeProvisioner(),
      });
    }).toThrow(/credentialStore/);
  });

  it("does NOT throw when both provisioner and store are provided", () => {
    expect(() => {
      const server = new ARCPServer({
        runtime: TEST_RUNTIME,
        capabilities: TEST_CAPABILITIES,
        credentialProvisioner: makeProvisioner(),
        credentialStore: new InMemoryCredentialStore(),
      });
      void server.close();
    }).not.toThrow();
  });

  it("does NOT throw when neither provisioner nor store is provided", () => {
    expect(() => {
      const server = new ARCPServer({
        runtime: TEST_RUNTIME,
        capabilities: TEST_CAPABILITIES,
      });
      void server.close();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. advertisedFeatures — feature flag gating
// ---------------------------------------------------------------------------

describe("ARCPServer.advertisedFeatures", () => {
  it("omits provisioned_credentials and model.use when no provisioner is configured", () => {
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: TEST_CAPABILITIES,
    });
    const flags = server.advertisedFeatures;
    expect(flags).not.toContain("provisioned_credentials");
    expect(flags).not.toContain("model.use");
    void server.close();
  });

  it("includes provisioned_credentials and model.use when provisioner is configured", () => {
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: TEST_CAPABILITIES,
      credentialProvisioner: makeProvisioner(),
      credentialStore: new InMemoryCredentialStore(),
    });
    const flags = server.advertisedFeatures;
    expect(flags).toContain("provisioned_credentials");
    expect(flags).toContain("model.use");
    void server.close();
  });

  it("preserves all non-credential feature flags when no provisioner", () => {
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: TEST_CAPABILITIES,
      features: [
        "streaming",
        "back_pressure",
        "model.use",
        "provisioned_credentials",
      ],
    });
    const flags = server.advertisedFeatures;
    // Non-credential flags are preserved.
    expect(flags).toContain("streaming");
    expect(flags).toContain("back_pressure");
    // Credential flags are stripped.
    expect(flags).not.toContain("model.use");
    expect(flags).not.toContain("provisioned_credentials");
    void server.close();
  });
});

// ---------------------------------------------------------------------------
// 4. Full lifecycle: mint → job.accepted has credentials → revoke on done
// ---------------------------------------------------------------------------

describe("provisioned credentials E2E lifecycle", () => {
  it("credentials appear in job.accepted and provisioner.revoke is called on completion", async () => {
    const provisioner = makeProvisioner([makeIssuedCredential("cred-e2e")]);
    const store = new InMemoryCredentialStore();

    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: TEST_CAPABILITIES,
      bearer: new StaticBearerVerifier(
        new Map([["tok", { principal: "alice" }]]),
      ),
      credentialProvisioner: provisioner,
      credentialStore: store,
      logger: silentLogger,
    });

    // Register a trivially-fast agent.
    server.registerAgent("noop", async () => null);

    const [client, serverSide] = pairMemoryTransports();
    server.accept(serverSide);

    // Single FrameCollector owns the one permitted onFrame handler for this
    // transport.  Both waitFor() calls below share the same collected buffer.
    const collector = new FrameCollector(client);

    await client.send(helloFrame("tok"));

    // Wait for session.welcome so we can extract the server-assigned session_id.
    // All subsequent frames MUST carry session_id (RoundTripEnvelopeSchema §5.1).
    const welcomeFrames = await collector.waitFor(
      (f) => f["type"] === "session.welcome",
    );
    const welcome = welcomeFrames.find((f) => f["type"] === "session.welcome");
    const sessionId = welcome!["session_id"] as string;

    await client.send(submitFrame("noop", sessionId));

    // job.accepted is delivered synchronously inside the submit send (fully
    // awaited delivery chain), so it will already be buffered by now.
    const acceptedFrames = await collector.waitFor(
      (f) => f["type"] === "job.accepted",
    );
    const accepted = acceptedFrames.find((f) => f["type"] === "job.accepted");
    expect(accepted).toBeDefined();
    const payload = accepted!["payload"] as Record<string, unknown>;
    expect(Array.isArray(payload["credentials"])).toBe(true);
    const creds = payload["credentials"] as Record<string, unknown>[];
    expect(creds).toHaveLength(1);
    expect(creds[0]?.["id"]).toBe("cred-e2e");
    // The wire value is present in the accepted envelope (client needs it).
    expect(creds[0]?.["value"]).toBe("fake-token-cred-e2e");

    // Wait for the job to complete (the handler is fire-and-forget so this
    // may arrive slightly after job.accepted).
    await collector.waitFor(
      (f) =>
        (f["type"] === "job.event" &&
          (f["payload"] as Record<string, unknown>)["final_status"] !==
            undefined) ||
        f["type"] === "job.result" ||
        f["type"] === "job.error",
    );

    // Give the non-blocking void revokeAll a tick to finish.
    await new Promise((r) => setTimeout(r, 50));

    // Provisioner.revoke must have been called with the provisioner-side id.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provisioner.revoke).toHaveBeenCalledWith("prov-cred-e2e");

    // The store entry should have been removed after revocation.
    const outstanding = await store.listOutstanding();
    expect(outstanding).toHaveLength(0);

    await client.close();
    await server.close();
  });

  it("stores the credential in the store before emitting job.accepted", async () => {
    const provisioner = makeProvisioner([
      makeIssuedCredential("cred-store-order"),
    ]);
    const store = new InMemoryCredentialStore();

    // Spy on store.add to verify it's called before job.accepted is received.
    let storeAddCalledCount = 0;
    const originalAdd = store.add.bind(store);
    store.add = async (entry) => {
      storeAddCalledCount++;
      return originalAdd(entry);
    };

    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: TEST_CAPABILITIES,
      bearer: new StaticBearerVerifier(
        new Map([["tok", { principal: "bob" }]]),
      ),
      credentialProvisioner: provisioner,
      credentialStore: store,
      logger: silentLogger,
    });
    server.registerAgent("noop", async () => null);

    const [client, serverSide] = pairMemoryTransports();
    server.accept(serverSide);

    // FrameCollector owns the single permitted onFrame handler.
    const collector = new FrameCollector(client);

    await client.send(helloFrame("tok"));

    // Extract the server-assigned session_id from session.welcome.
    // All subsequent frames MUST carry session_id (RoundTripEnvelopeSchema §5.1).
    const welcomeFrames = await collector.waitFor(
      (f) => f["type"] === "session.welcome",
    );
    const welcome = welcomeFrames.find((f) => f["type"] === "session.welcome");
    const sessionId = welcome!["session_id"] as string;

    await client.send(submitFrame("noop", sessionId));

    // Wait until job.accepted arrives.
    const acceptedFrames = await collector.waitFor(
      (f) => f["type"] === "job.accepted",
    );

    const accepted = acceptedFrames.find((f) => f["type"] === "job.accepted");
    expect(accepted).toBeDefined();
    // By the time we receive job.accepted, store.add must have already been called
    // (issueCredentials → store.add is awaited before job.emitAccepted).
    expect(storeAddCalledCount).toBe(1);

    await client.close();
    await server.close();
  });

  it("keeps store entries when revocation fails so recovery can retry", async () => {
    const provisioner = makeProvisioner([makeIssuedCredential("cred-retry")]);
    vi.mocked(provisioner.revoke).mockRejectedValueOnce(new Error("offline"));
    const store = new InMemoryCredentialStore();

    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: TEST_CAPABILITIES,
      bearer: new StaticBearerVerifier(
        new Map([["tok", { principal: "alice" }]]),
      ),
      credentialProvisioner: provisioner,
      credentialStore: store,
      logger: silentLogger,
    });
    server.registerAgent("noop", async () => null);

    const [client, serverSide] = pairMemoryTransports();
    server.accept(serverSide);
    const collector = new FrameCollector(client);

    await client.send(helloFrame("tok"));
    const welcomeFrames = await collector.waitFor(
      (f) => f["type"] === "session.welcome",
    );
    const welcome = welcomeFrames.find((f) => f["type"] === "session.welcome");
    const sessionId = welcome!["session_id"] as string;

    await client.send(submitFrame("noop", sessionId));
    await collector.waitFor((f) => f["type"] === "job.result");
    await new Promise((r) => setTimeout(r, 50));

    const outstanding = await store.listOutstanding();
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]?.credentialId).toBe("cred-retry");

    await client.close();
    await server.close();
  });
});

// ---------------------------------------------------------------------------
// 5. Credential confidentiality: non-submitter does not receive credentials
// ---------------------------------------------------------------------------

describe("credential confidentiality in job.subscribed (§14)", () => {
  it("submitter receives credentials in job.subscribed; observer does not", async () => {
    const provisioner = makeProvisioner([makeIssuedCredential("cred-conf")]);
    const store = new InMemoryCredentialStore();

    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: TEST_CAPABILITIES,
      bearer: new StaticBearerVerifier(
        new Map([
          ["tok-alice", { principal: "alice" }],
          ["tok-bob", { principal: "bob" }],
        ]),
      ),
      credentialProvisioner: provisioner,
      credentialStore: store,
      // Allow cross-principal subscription so bob can observe alice's job.
      jobAuthorizationPolicy: () => true,
      logger: silentLogger,
    });

    // Agent that hangs briefly so the job is observable while active.
    server.registerAgent("slow-noop", async () => {
      await new Promise((r) => setTimeout(r, 200));
      return null;
    });

    const [aliceClient, aliceServerSide] = pairMemoryTransports();
    const [bobClient, bobServerSide] = pairMemoryTransports();
    server.accept(aliceServerSide);
    server.accept(bobServerSide);

    // Each transport gets exactly one FrameCollector — satisfying the
    // single-handler constraint while allowing multiple waitFor() calls.
    const aliceCollector = new FrameCollector(aliceClient);
    const bobCollector = new FrameCollector(bobClient);

    // Alice establishes her session and submits the job.
    await aliceClient.send(helloFrame("tok-alice"));

    // Extract session_id from alice's session.welcome — required on every
    // subsequent frame (RoundTripEnvelopeSchema §5.1).
    const aliceWelcomeFrames = await aliceCollector.waitFor(
      (f) => f["type"] === "session.welcome",
    );
    const aliceWelcome = aliceWelcomeFrames.find(
      (f) => f["type"] === "session.welcome",
    );
    const aliceSessionId = aliceWelcome!["session_id"] as string;

    await aliceClient.send(submitFrame("slow-noop", aliceSessionId));

    // job.accepted is delivered synchronously within the submit send.
    const aliceAcceptedFrames = await aliceCollector.waitFor(
      (f) => f["type"] === "job.accepted",
    );
    const aliceAccepted = aliceAcceptedFrames.find(
      (f) => f["type"] === "job.accepted",
    );
    const jobId = (aliceAccepted!["payload"] as Record<string, unknown>)[
      "job_id"
    ] as string;

    // Bob establishes his session.
    await bobClient.send(helloFrame("tok-bob"));
    // Wait for bob's session.welcome and extract his session_id.
    // All subsequent frames from bob MUST carry his session_id.
    const bobWelcomeFrames = await bobCollector.waitFor(
      (f) => f["type"] === "session.welcome",
    );
    const bobWelcome = bobWelcomeFrames.find(
      (f) => f["type"] === "session.welcome",
    );
    const bobSessionId = bobWelcome!["session_id"] as string;

    // Bob subscribes to Alice's job.
    await bobClient.send({
      arcp: PROTOCOL_VERSION,
      id: "msg-sub",
      type: "job.subscribe",
      session_id: bobSessionId,
      payload: { job_id: jobId },
    });
    const bobFrames = await bobCollector.waitFor(
      (f) => f["type"] === "job.subscribed",
    );
    const bobSubscribed = bobFrames.find((f) => f["type"] === "job.subscribed");
    expect(bobSubscribed).toBeDefined();
    const bobPayload = bobSubscribed!["payload"] as Record<string, unknown>;
    // Bob (different principal) must NOT receive credentials.
    expect(bobPayload["credentials"]).toBeUndefined();

    // Alice subscribes to her own job — reuses aliceCollector (no second onFrame).
    await aliceClient.send({
      arcp: PROTOCOL_VERSION,
      id: "msg-sub-alice",
      type: "job.subscribe",
      session_id: aliceSessionId,
      payload: { job_id: jobId },
    });
    const aliceSubFrames = await aliceCollector.waitFor(
      (f) => f["type"] === "job.subscribed",
    );
    const aliceSubscribed = aliceSubFrames.find(
      (f) => f["type"] === "job.subscribed",
    );
    expect(aliceSubscribed).toBeDefined();
    const aliceSubPayload = aliceSubscribed!["payload"] as Record<
      string,
      unknown
    >;
    // Alice (original submitter) SHOULD receive credentials.
    expect(Array.isArray(aliceSubPayload["credentials"])).toBe(true);
    const aliceCreds = aliceSubPayload["credentials"] as Record<
      string,
      unknown
    >[];
    expect(aliceCreds[0]?.["id"]).toBe("cred-conf");

    await aliceClient.close();
    await bobClient.close();
    await server.close();
  });

  it("observer receives budget + lease_constraints on job.subscribed (§7.6)", async () => {
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: TEST_CAPABILITIES,
      bearer: new StaticBearerVerifier(
        new Map([
          ["tok-alice", { principal: "alice" }],
          ["tok-bob", { principal: "bob" }],
        ]),
      ),
      // Cross-principal subscription so bob can observe alice's job.
      jobAuthorizationPolicy: () => true,
      logger: silentLogger,
    });
    server.registerAgent("slow-noop", async () => {
      await new Promise((r) => setTimeout(r, 200));
      return null;
    });

    const [aliceClient, aliceServerSide] = pairMemoryTransports();
    const [bobClient, bobServerSide] = pairMemoryTransports();
    server.accept(aliceServerSide);
    server.accept(bobServerSide);
    const aliceCollector = new FrameCollector(aliceClient);
    const bobCollector = new FrameCollector(bobClient);

    // Alice negotiates cost.budget + lease_expires_at so the runtime
    // initializes/echoes those bounds.
    await aliceClient.send({
      arcp: PROTOCOL_VERSION,
      id: "msg-hello",
      type: "session.hello",
      payload: {
        client: { name: "test-client", version: "0.0.1" },
        capabilities: {
          encodings: ["json"],
          features: ["subscribe", "cost.budget", "lease_expires_at"],
        },
        auth: { scheme: "bearer", token: "tok-alice" },
      },
    });
    const aliceSessionId = (
      await aliceCollector.waitFor((f) => f["type"] === "session.welcome")
    ).find((f) => f["type"] === "session.welcome")!["session_id"] as string;

    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    await aliceClient.send({
      arcp: PROTOCOL_VERSION,
      id: "msg-submit-budget",
      type: "job.submit",
      session_id: aliceSessionId,
      payload: {
        agent: "slow-noop",
        input: {},
        lease_request: { "cost.budget": ["USD:5.00"] },
        lease_constraints: { expires_at: expiresAt },
      },
    });
    const jobId = (
      (await aliceCollector.waitFor((f) => f["type"] === "job.accepted")).find(
        (f) => f["type"] === "job.accepted",
      )!["payload"] as Record<string, unknown>
    )["job_id"] as string;

    await bobClient.send(helloFrame("tok-bob"));
    const bobSessionId = (
      await bobCollector.waitFor((f) => f["type"] === "session.welcome")
    ).find((f) => f["type"] === "session.welcome")!["session_id"] as string;

    await bobClient.send({
      arcp: PROTOCOL_VERSION,
      id: "msg-sub-budget",
      type: "job.subscribe",
      session_id: bobSessionId,
      payload: { job_id: jobId },
    });
    const payload = (
      await bobCollector.waitFor((f) => f["type"] === "job.subscribed")
    ).find((f) => f["type"] === "job.subscribed")!["payload"] as Record<
      string,
      unknown
    >;

    // Observer (bob) gets the non-secret authority bounds...
    expect(payload["budget"]).toEqual({ USD: 5 });
    expect(
      (payload["lease_constraints"] as Record<string, unknown> | undefined)?.[
        "expires_at"
      ],
    ).toBe(expiresAt);
    // ...but never credentials.
    expect(payload["credentials"]).toBeUndefined();

    await aliceClient.close();
    await bobClient.close();
    await server.close();
  });
});
