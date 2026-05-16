import { PassThrough } from "node:stream";

import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { StdioTransport, stdioTransportEffect } from "@arcp/core";

/**
 * Build a pair of {@link StdioTransport}s wired via in-memory `PassThrough`
 * streams so a→b sends arrive as b's inbound frames.
 */
function makeStdioPair(): [StdioTransport, StdioTransport] {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const a = new StdioTransport(bToA, aToB);
  const b = new StdioTransport(aToB, bToA);
  return [a, b];
}

describe("StdioTransport (legacy)", () => {
  it("round-trips a single frame via in-memory streams", async () => {
    const [a, b] = makeStdioPair();
    const received: unknown[] = [];
    b.onFrame((frame) => {
      received.push(frame);
    });
    await a.send({ hello: "world" });
    // Allow newline-delimited readline to flush.
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(received).toEqual([{ hello: "world" }]);
    await a.close();
    await b.close();
  });
});

describe("stdioTransportEffect", () => {
  it("round-trips a single frame via Stream", async () => {
    const [a, b] = makeStdioPair();
    const bEffect = stdioTransportEffect(b);
    const aEffect = stdioTransportEffect(a);
    const collected = Effect.runPromise(
      Stream.runCollect(Stream.take(bEffect.incoming, 1)),
    );
    await Effect.runPromise(aEffect.send({ hello: "effect" }));
    const chunk = await collected;
    expect([...chunk]).toEqual([{ hello: "effect" }]);
    await Effect.runPromise(aEffect.close);
    await Effect.runPromise(bEffect.close);
  });
});
