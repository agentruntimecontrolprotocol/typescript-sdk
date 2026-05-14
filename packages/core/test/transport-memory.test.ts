import { pairMemoryTransports } from "@arcp/core";
import { describe, expect, it } from "vitest";

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
