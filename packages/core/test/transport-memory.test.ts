import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { pairMemoryTransports, pairMemoryTransportsEffect } from "@arcp/core";

describe("pairMemoryTransports", () => {
  it("delivers frames in FIFO order from a to b", async () => {
    const [a, b] = pairMemoryTransports();
    const received: number[] = [];
    b.onFrame((frame) => {
      received.push(frame["n"] as number);
    });
    for (let i = 0; i < 5; i++) {
      await a.send({ n: i });
    }
    expect(received).toEqual([0, 1, 2, 3, 4]);
  });

  it("buffers frames sent before the recipient registers a handler", async () => {
    const [a, b] = pairMemoryTransports();
    await a.send({ n: 1 });
    await a.send({ n: 2 });
    const received: number[] = [];
    b.onFrame((frame) => {
      received.push(frame["n"] as number);
    });
    // Drain happens asynchronously in onFrame; await a microtask.
    await new Promise<void>((r) => setTimeout(r, 5));
    expect(received).toEqual([1, 2]);
  });

  it("close on one side closes the other and fires onClose", async () => {
    const [a, b] = pairMemoryTransports();
    let closeReason: Error | undefined;
    b.onClose((err) => {
      closeReason = err;
    });
    await a.close("bye");
    expect(b.closed).toBe(true);
    expect(closeReason?.message).toBe("bye");
  });

  it("send after close rejects", async () => {
    const [a, b] = pairMemoryTransports();
    void b;
    await a.close();
    await expect(a.send({})).rejects.toThrow();
  });
});

describe("pairMemoryTransportsEffect", () => {
  it("delivers 10 frames a→b in order via Stream.take", async () => {
    const [a, b] = pairMemoryTransportsEffect();
    const take = Effect.runPromise(
      Stream.runCollect(Stream.take(b.incoming, 10)),
    );
    for (let i = 0; i < 10; i++) {
      await Effect.runPromise(a.send({ n: i }));
    }
    const chunk = await take;
    const ns = [...chunk].map((f) => f["n"] as number);
    expect(ns).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("close on one side ends the peer's incoming stream", async () => {
    const [a, b] = pairMemoryTransportsEffect();
    const collected = Effect.runPromise(Stream.runCollect(b.incoming));
    await Effect.runPromise(a.send({ k: "v" }));
    await Effect.runPromise(a.close);
    const chunk = await collected;
    expect([...chunk]).toEqual([{ k: "v" }]);
    expect(b.isClosed()).toBe(true);
  });

  it("send after close fails with TaggedTransportError", async () => {
    const [a, b] = pairMemoryTransportsEffect();
    void b;
    await Effect.runPromise(a.close);
    const exit = await Effect.runPromiseExit(a.send({ n: 1 }));
    expect(exit._tag).toBe("Failure");
  });
});
