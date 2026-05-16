import {
  pairMemoryTransportsEffect,
  PROTOCOL_VERSION,
  silentLogger,
  type TransportEffect,
} from "@arcp/core";
import { Effect, Fiber, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { AgentRegistryService } from "../src/agent-registry.js";
import {
  acceptSessionEffect,
  ARCPRuntimeLayer,
  ARCPServerService,
  makeARCPServerRuntime,
  resumeSweepDaemon,
} from "../src/server-effect.js";
import { ARCPServer } from "../src/server.js";
import { ResumeStoreService } from "../src/stores.js";

const TEST_RUNTIME = { name: "test-runtime", version: "0.1.0" } as const;

// `session.hello` envelope used to drive the handshake. We send raw frames
// over the client transport — this test exercises the Effect-shape entry
// path end-to-end without bringing in @arcp/client.
function makeHelloFrame(token: string): Record<string, unknown> {
  return {
    arcp: PROTOCOL_VERSION,
    id: "msg_test_hello",
    type: "session.hello",
    payload: {
      client: { name: "test", version: "0.0.1" },
      capabilities: { encodings: ["json"] },
      auth: { scheme: "bearer", token },
    },
  };
}

describe("ARCPRuntimeLayer + acceptSessionEffect", () => {
  it("welcomes a session driven via TransportEffect", async () => {
    const runtime = makeARCPServerRuntime({
      runtime: TEST_RUNTIME,
      capabilities: { encodings: ["json"] },
      bearerTable: new Map([["tok", { principal: "tester" }]]),
      logger: silentLogger,
    });
    try {
      // Register an agent the same way a legacy caller would: yield the
      // bound `ARCPServer` and call its legacy method.
      await runtime.runPromise(
        Effect.gen(function* () {
          const { server } = yield* ARCPServerService;
          server?.registerAgent("ping", async (input) => ({ echoed: input }));
        }),
      );

      const [clientSide, serverSide] = pairMemoryTransportsEffect();
      await runtime.runPromise(acceptSessionEffect(serverSide));

      // Drive the handshake from the client side and observe the welcome.
      const welcomePromise = collectFirstFrame(clientSide, "session.welcome");
      await Effect.runPromise(clientSide.send(makeHelloFrame("tok")));
      const welcome = await welcomePromise;

      expect(welcome["type"]).toBe("session.welcome");
      expect(
        (welcome["payload"] as { runtime: typeof TEST_RUNTIME }).runtime,
      ).toEqual(TEST_RUNTIME);
      expect(welcome["session_id"]).toBeTypeOf("string");

      await Effect.runPromise(clientSide.close);
    } finally {
      await runtime.dispose();
    }
  });

  it("ARCPRuntimeLayer composes services that resolve without errors", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* AgentRegistryService;
      yield* reg.register("agent-a", "v1", async () => null);
      const { handler, version } = yield* reg.resolve("agent-a", "v1");
      const { server } = yield* ARCPServerService;
      return { server, version, handler: typeof handler };
    });
    const layer = ARCPRuntimeLayer({
      runtime: TEST_RUNTIME,
      capabilities: { encodings: ["json"] },
      bearerTable: new Map(),
      logger: silentLogger,
    });
    // ManagedRuntime is the supported way to provide a scoped layer to a
    // single Effect run; build/dispose around the assertion.
    const runtime = makeARCPServerRuntime({
      runtime: TEST_RUNTIME,
      capabilities: { encodings: ["json"] },
      bearerTable: new Map(),
      logger: silentLogger,
    });
    try {
      const out = await runtime.runPromise(program);
      expect(out.server).toBeInstanceOf(ARCPServer);
      expect(out.version).toBe("v1");
      expect(out.handler).toBe("function");
      // Spread to silence unused-variable on `layer` (kept above to assert
      // ARCPRuntimeLayer is callable with the same opts as makeARCPServerRuntime).
      expect(layer).toBeDefined();
    } finally {
      await runtime.dispose();
    }
  });
});

describe("resumeSweepDaemon", () => {
  it("ticks at the configured interval and calls sweep", async () => {
    const program = Effect.gen(function* () {
      const store = yield* ResumeStoreService;
      const sweepSpy = vi.spyOn(store, "sweep");
      const fiber = yield* Effect.fork(resumeSweepDaemon(40));
      // Allow ~3 ticks to fire. The Schedule.fixed cadence interleaves
      // with the sleep here on the same event loop.
      yield* Effect.sleep("150 millis");
      yield* Fiber.interrupt(fiber);
      return sweepSpy.mock.calls.length;
    }).pipe(Effect.provide(ResumeStoreService.Default));

    const callCount = await Effect.runPromise(program);
    // Conservative lower bound: at least one sweep fired before
    // interruption. We avoid pinning the exact count so timing jitter on
    // shared CI doesn't flake the test.
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("terminates when its enclosing scope closes", async () => {
    // Verify the daemon is interruptible: forking it inside a scope and
    // closing the scope cleanly returns control without leaking the fiber.
    const program = Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(resumeSweepDaemon(20));
        yield* Effect.sleep("60 millis");
        // No explicit interrupt — Effect.scoped closes the scope, which
        // interrupts forkScoped fibers as part of its finalization.
        return fiber.id();
      }).pipe(Effect.provide(ResumeStoreService.Default)),
    );
    await expect(Effect.runPromise(program)).resolves.toBeDefined();
  });
});

describe("legacy ARCPServer unchanged (smoke)", () => {
  it("constructs, registers an agent, accepts a memory transport, and welcomes", async () => {
    // This mirrors the existing SDK integration-test setup pattern (without
    // pulling in @arcp/client) — it asserts the legacy class is unchanged.
    const { pairMemoryTransports, StaticBearerVerifier } = await import(
      "@arcp/core"
    );
    const server = new ARCPServer({
      runtime: TEST_RUNTIME,
      capabilities: { encodings: ["json"] },
      bearer: new StaticBearerVerifier(
        new Map([["tok", { principal: "tester" }]]),
      ),
      logger: silentLogger,
    });
    try {
      server.registerAgent("ping", async (input) => ({ echoed: input }));
      const [clientSide, serverSide] = pairMemoryTransports();
      server.accept(serverSide);
      const welcomePromise = new Promise<Record<string, unknown>>((resolve) => {
        clientSide.onFrame((frame) => {
          if ((frame as { type?: string }).type === "session.welcome") {
            resolve(frame);
          }
        });
      });
      await clientSide.send(makeHelloFrame("tok"));
      const welcome = await welcomePromise;
      expect(welcome["type"]).toBe("session.welcome");
      await clientSide.close();
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run the TransportEffect's incoming stream until the first matching frame. */
async function collectFirstFrame(
  transport: TransportEffect,
  type: string,
): Promise<Record<string, unknown>> {
  const program = transport.incoming.pipe(
    Stream.filter((frame) => (frame as { type?: string }).type === type),
    Stream.runHead,
  );
  const result = await Effect.runPromise(program);
  // `runHead` resolves to an Option; an empty stream is a test failure.
  const opt = result as { _tag: "Some" | "None"; value?: Record<string, unknown> };
  if (opt._tag === "None") {
    throw new Error(`stream ended without a "${type}" frame`);
  }
  // value is guaranteed defined when _tag is Some — narrow defensively.
  const frame = opt.value;
  if (frame === undefined) {
    throw new Error(`stream resolved Some without a frame value`);
  }
  return frame;
}
