import { silentLogger } from "@agentruntimecontrolprotocol/core/logger";
import { describe, expect, it, vi } from "vitest";

import { SessionContext } from "../src/session-context.js";

describe("SessionContext heartbeat", () => {
  it("closes the session on heartbeat loss without cancelling jobs", async () => {
    const transport = {
      closed: false,
      send: vi.fn(async () => undefined),
      onFrame: vi.fn(),
      onClose: vi.fn(),
      close: vi.fn(async function close(this: { closed: boolean }) {
        this.closed = true;
      }),
    };
    const server = {
      options: { heartbeatIntervalSeconds: 1 },
      dropSession: vi.fn(),
      eventLog: { append: vi.fn(async () => true) },
      subscribers: new Map(),
    };
    const ctx = new SessionContext(transport, server as never, silentLogger);
    ctx.state.assignId("sess_1");
    ctx.assignNegotiatedFeatures(["heartbeat"]);
    const cancelAll = vi.spyOn(ctx.jobs, "cancelAll");
    const emitSessionError = vi
      .spyOn(ctx, "emitSessionError")
      .mockResolvedValue(undefined);

    const internals = ctx as unknown as {
      lastInboundAt: number;
      heartbeatTick(intervalMs: number): Promise<void>;
    };
    internals.lastInboundAt = Date.now() - 3000;
    await internals.heartbeatTick(1000);

    expect(emitSessionError).toHaveBeenCalled();
    expect(cancelAll).not.toHaveBeenCalled();
    expect(server.dropSession).toHaveBeenCalledWith(ctx);
    expect(transport.close).toHaveBeenCalledWith("heartbeat lost");
  });
});

describe("SessionContext.send durability (§6.3, issue #145)", () => {
  function makeHarness(appendImpl: (env: unknown) => boolean) {
    const order: string[] = [];
    const transport = {
      closed: false,
      send: vi.fn(async () => {
        order.push("transport.send");
      }),
      onFrame: vi.fn(),
      onClose: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const server = {
      options: {},
      dropSession: vi.fn(),
      eventLog: {
        append: vi.fn(async (env: unknown) => {
          order.push("append");
          return appendImpl(env);
        }),
      },
      subscribers: new Map(),
    };
    const ctx = new SessionContext(transport, server as never, silentLogger);
    ctx.state.assignId("sess_1");
    return { ctx, transport, server, order };
  }

  const seqEnvelope = {
    arcp: "1.1",
    id: "msg_seq_1",
    type: "job.event",
    session_id: "sess_1",
    job_id: "job_1",
    event_seq: 1,
    payload: { kind: "log", ts: new Date().toISOString(), body: {} },
  };

  it("appends an event_seq envelope before it is sent on the wire", async () => {
    const { ctx, order } = makeHarness(() => true);
    await ctx.send(seqEnvelope as never);
    expect(order).toEqual(["append", "transport.send"]);
  });

  it("fails the send when persisting an event_seq envelope fails", async () => {
    const { ctx, transport } = makeHarness(() => {
      throw new Error("disk full");
    });
    await expect(ctx.send(seqEnvelope as never)).rejects.toThrow("disk full");
    // The unresumable event MUST NOT become observable on the wire.
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("tolerates a persist failure for a non-seq ack envelope", async () => {
    const { ctx, transport } = makeHarness(() => {
      throw new Error("disk full");
    });
    const ackEnvelope = {
      arcp: "1.1",
      id: "msg_ack_1",
      type: "job.accepted",
      session_id: "sess_1",
      job_id: "job_1",
      payload: {
        job_id: "job_1",
        lease: {},
        accepted_at: new Date().toISOString(),
      },
    };
    await expect(ctx.send(ackEnvelope as never)).resolves.toBeUndefined();
    // Acks are not part of the resume replay, so the send still succeeds.
    expect(transport.send).toHaveBeenCalled();
  });
});
