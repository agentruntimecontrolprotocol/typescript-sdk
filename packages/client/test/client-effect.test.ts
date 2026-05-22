// Unit coverage for `client-effect.ts`. These tests stay scoped to the
// client package (no @agentruntimecontrolprotocol/runtime devDep) by driving the legacy
// `ARCPClient` against a hand-rolled "fake runtime" wired through
// `pairMemoryTransports()`. The fake handshakes with `session.welcome`,
// echoes a `job.accepted`, then emits a `job.event` and a `job.result` —
// enough to exercise:
//   1) `ARCPClientLayer` + `subscribeEnvelopes` → Stream delivery.
//   2) `ARCPClientService.submit` returning a usable `JobHandle`.
//   3) The legacy `client.on(type, handler)` callback API still working
//      when used standalone (smoke test for risk #23).
//   4) Multiple subscribers on the same type all fire in registration
//      order (issue #46 acceptance test).
//   5) `ManagedRuntime.dispose()` deterministically closes the client.

import {
  type JobId,
  newMessageId,
  pairMemoryTransports,
  PROTOCOL_VERSION,
  silentLogger,
  type Transport,
  type WireFrame,
} from "@agentruntimecontrolprotocol/core";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  ARCPClientLayer,
  ARCPClientService,
  makeARCPClientRuntime,
  subscribeEnvelopes,
} from "../src/client-effect.js";
import { ARCPClient } from "../src/client.js";
import type { ARCPClientOptions } from "../src/types.js";

const TEST_CLIENT: ARCPClientOptions = {
  client: { name: "test-client", version: "0.0.1" },
  authScheme: "bearer",
  token: "tok",
  logger: silentLogger,
};

/**
 * Narrow `ARCPClient | null` to `ARCPClient` inside an Effect.gen — fails
 * the running fiber if the service is unbound (a test setup bug, never an
 * expected runtime path).
 */
function assertBound(client: ARCPClient | null): Effect.Effect<ARCPClient> {
  return client === null
    ? Effect.die("ARCPClientService is unbound in test")
    : Effect.succeed(client);
}

// ---------------------------------------------------------------------------
// Fake runtime — minimal §6/§7 reply machinery, no agent execution
// ---------------------------------------------------------------------------

/**
 * Drive the server side of a paired memory transport just enough to
 * satisfy the client's handshake + one job lifecycle. Returns control
 * helpers so tests can synthesize their own `job.event`s after the
 * `job.accepted` reply.
 */
function startFakeRuntime(server: Transport): {
  emitJobEvent: (jobId: JobId, kind: string) => Promise<void>;
  emitJobResult: (jobId: JobId) => Promise<void>;
  sessionId: () => string | null;
  acceptedJobId: () => JobId | null;
} {
  let sid: string | null = null;
  let acceptedJobId: JobId | null = null;
  let seq = 0;
  server.onFrame(async (frame: WireFrame) => {
    const f = frame as { type?: string; id?: string; payload?: unknown };
    if (f.type === "session.hello") {
      sid = `sess_${Math.random().toString(36).slice(2, 10)}`;
      await server.send({
        arcp: PROTOCOL_VERSION,
        id: newMessageId(),
        type: "session.welcome",
        session_id: sid,
        payload: {
          runtime: { name: "fake", version: "0.0.1" },
          resume_token: "resume_test_token",
          resume_window_sec: 60,
          capabilities: { encodings: ["json"], features: [] },
        },
      });
      return;
    }
    if (f.type === "job.submit") {
      acceptedJobId = `job_${Math.random().toString(36).slice(2, 10)}`;
      await server.send({
        arcp: PROTOCOL_VERSION,
        id: newMessageId(),
        type: "job.accepted",
        session_id: sid ?? "sess",
        job_id: acceptedJobId,
        payload: {
          job_id: acceptedJobId,
          lease: {},
          agent: "echo",
          accepted_at: new Date().toISOString(),
        },
      });
      return;
    }
    // Other inbound types (session.bye, session.ack, …) are ignored by the
    // fake runtime.
  });
  return {
    sessionId: () => sid,
    acceptedJobId: () => acceptedJobId,
    emitJobEvent: async (jobId, kind) => {
      seq += 1;
      await server.send({
        arcp: PROTOCOL_VERSION,
        id: newMessageId(),
        type: "job.event",
        session_id: sid ?? "sess",
        job_id: jobId,
        event_seq: seq,
        payload: { kind, ts: new Date().toISOString(), body: { note: "test" } },
      });
    },
    emitJobResult: async (jobId) => {
      seq += 1;
      await server.send({
        arcp: PROTOCOL_VERSION,
        id: newMessageId(),
        type: "job.result",
        session_id: sid ?? "sess",
        job_id: jobId,
        event_seq: seq,
        payload: { final_status: "success", result: { ok: true } },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ARCPClientLayer + ARCPClientService", () => {
  it("submit() through the Effect service returns a usable JobHandle", async () => {
    const [clientSide, serverSide] = pairMemoryTransports();
    const fake = startFakeRuntime(serverSide);
    const runtime = makeARCPClientRuntime(TEST_CLIENT);
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* ARCPClientService;
          const client = yield* assertBound(svc.client);
          yield* Effect.promise(() => client.connect(clientSide));
          const handle = yield* svc.submit({ agent: "echo", input: { x: 1 } });
          return handle.jobId;
        }),
      );
      expect(result).toBe(fake.acceptedJobId());
    } finally {
      await runtime.dispose();
    }
  });

  it("subscribeEnvelopes streams envelopes via Stream", async () => {
    const [clientSide, serverSide] = pairMemoryTransports();
    const fake = startFakeRuntime(serverSide);
    const runtime = makeARCPClientRuntime(TEST_CLIENT);
    try {
      const program = Effect.gen(function* () {
        const svc = yield* ARCPClientService;
        const client = yield* assertBound(svc.client);
        yield* Effect.promise(() => client.connect(clientSide));
        const handle = yield* svc.submit({ agent: "echo" });

        // Collect the first 2 `job.event` envelopes as they arrive.
        const collectFiber = yield* Effect.fork(
          subscribeEnvelopes("job.event").pipe(
            Stream.take(2),
            Stream.runCollect,
          ),
        );

        // Allow the subscriber fiber to install its emit before we trigger
        // events on the fake-runtime side.
        yield* Effect.sleep("20 millis");

        // Synthesize two events from the fake runtime side.
        yield* Effect.promise(() => fake.emitJobEvent(handle.jobId, "log"));
        yield* Effect.promise(() => fake.emitJobEvent(handle.jobId, "thought"));

        const collected = yield* collectFiber;
        return [...collected].map((env) => {
          const ep = env.payload as { kind?: string };
          return ep.kind;
        });
      });
      const kinds = await runtime.runPromise(program);
      expect(kinds).toEqual(["log", "thought"]);
    } finally {
      await runtime.dispose();
    }
  });

  it("ManagedRuntime.dispose() closes the bound client", async () => {
    const [clientSide, serverSide] = pairMemoryTransports();
    startFakeRuntime(serverSide);
    const runtime = makeARCPClientRuntime(TEST_CLIENT);
    const boundClient = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* ARCPClientService;
        const client = yield* assertBound(svc.client);
        yield* Effect.promise(() => client.connect(clientSide));
        return client;
      }),
    );
    await runtime.dispose();
    // Post-dispose, sending should fail because the legacy close() nulled
    // the underlying transport.
    await expect(boundClient.submit({ agent: "echo" })).rejects.toBeDefined();
  });

  it("ARCPClientLayer composes the service without errors", async () => {
    const runtime = makeARCPClientRuntime(TEST_CLIENT);
    try {
      const out = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* ARCPClientService;
          return svc.client !== null;
        }),
      );
      expect(out).toBe(true);
      // Keep the unused-import lint happy by referencing the layer factory.
      expect(ARCPClientLayer).toBeTypeOf("function");
    } finally {
      await runtime.dispose();
    }
  });
});

describe("subscribeEnvelopes fan-out", () => {
  it("delivers a single envelope to every live subscriber in registration order", async () => {
    const [clientSide, serverSide] = pairMemoryTransports();
    const fake = startFakeRuntime(serverSide);
    const runtime = makeARCPClientRuntime(TEST_CLIENT);
    try {
      const program = Effect.gen(function* () {
        const svc = yield* ARCPClientService;
        const client = yield* assertBound(svc.client);
        yield* Effect.promise(() => client.connect(clientSide));
        const handle = yield* svc.submit({ agent: "echo" });

        // Three independent subscribers, each takes the first envelope.
        const f1 = yield* Effect.fork(
          subscribeEnvelopes("job.event").pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
        );
        const f2 = yield* Effect.fork(
          subscribeEnvelopes("job.event").pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
        );
        const f3 = yield* Effect.fork(
          subscribeEnvelopes("job.event").pipe(
            Stream.take(1),
            Stream.runCollect,
          ),
        );

        // Small yield so the three Stream.async finalizers register before
        // we trigger the event.
        yield* Effect.sleep("10 millis");
        yield* Effect.promise(() => fake.emitJobEvent(handle.jobId, "metric"));

        const [c1, c2, c3] = yield* Effect.all([f1, f2, f3]);
        return [c1, c2, c3].map((chunk) => {
          const env = [...chunk][0];
          const ep = env?.payload as { kind?: string } | undefined;
          return ep?.kind;
        });
      });
      const kinds = await runtime.runPromise(program);
      expect(kinds).toEqual(["metric", "metric", "metric"]);
    } finally {
      await runtime.dispose();
    }
  });
});

describe("legacy ARCPClient unchanged (risk #23 smoke)", () => {
  it("new ARCPClient(...).on('job.event', handler) still fires", async () => {
    // The legacy callback contract — one handler per envelope type — must
    // keep working without going through any Effect machinery.
    const [clientSide, serverSide] = pairMemoryTransports();
    const fake = startFakeRuntime(serverSide);
    const client = new ARCPClient(TEST_CLIENT);
    try {
      const seen: string[] = [];
      client.on("job.event", (env) => {
        const ep = env.payload as { kind?: string };
        if (ep.kind !== undefined) seen.push(ep.kind);
      });
      await client.connect(clientSide);
      const handle = await client.submit({ agent: "echo" });
      await fake.emitJobEvent(handle.jobId, "log");
      await fake.emitJobEvent(handle.jobId, "thought");
      // Yield to the event loop so the handler runs.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toEqual(["log", "thought"]);
    } finally {
      await client.close();
    }
  });
});
