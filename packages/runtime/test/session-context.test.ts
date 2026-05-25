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
    const ctx = new SessionContext(
      transport as never,
      server as never,
      silentLogger,
    );
    ctx.state.assignId("sess_1" as never);
    ctx.assignNegotiatedFeatures(["heartbeat"]);
    const cancelAll = vi.spyOn(ctx.jobs, "cancelAll");
    const emitSessionError = vi
      .spyOn(ctx, "emitSessionError")
      .mockResolvedValue(undefined);

    const internals = ctx as unknown as {
      lastInboundAt: number;
      heartbeatTick(intervalMs: number): Promise<void>;
    };
    internals.lastInboundAt = Date.now() - 3_000;
    await internals.heartbeatTick(1_000);

    expect(emitSessionError).toHaveBeenCalled();
    expect(cancelAll).not.toHaveBeenCalled();
    expect(server.dropSession).toHaveBeenCalledWith(ctx);
    expect(transport.close).toHaveBeenCalledWith("heartbeat lost");
  });
});
