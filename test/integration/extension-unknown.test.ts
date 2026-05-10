import { describe, expect, it } from "vitest";
import { type Envelope, PROTOCOL_VERSION, type WireFrame } from "../../src/index.js";
import { awaitNonNull, makePairedHarness } from "../helpers/fixtures.js";

describe("§21.3 unknown message handling", () => {
  it("unknown core-prefixed type ⇒ nack UNIMPLEMENTED", async () => {
    const h = makePairedHarness();
    await h.connect();
    let nack: { code?: string } | null = null;
    h.client.on("nack", (env: Envelope) => {
      if (env.type === "nack") nack = { code: env.payload.code };
    });
    const frame: WireFrame = {
      arcp: PROTOCOL_VERSION,
      id: "msg_unknown_core",
      type: "session.frobnicate",
      timestamp: "2026-05-09T13:00:00Z",
      session_id: h.client.state.id,
      payload: {},
    };
    await h.clientTransport.send(frame);
    const n = await awaitNonNull(() => nack);
    expect(n.code).toBe("UNIMPLEMENTED");
    await h.close();
  });

  it("unknown namespaced type without optional flag ⇒ nack UNIMPLEMENTED", async () => {
    const h = makePairedHarness();
    await h.connect();
    let nack: { code?: string } | null = null;
    h.client.on("nack", (env: Envelope) => {
      if (env.type === "nack") nack = { code: env.payload.code };
    });
    const frame: WireFrame = {
      arcp: PROTOCOL_VERSION,
      id: "msg_unknown_ext",
      type: "arcpx.acme.frobnicate.v1",
      timestamp: "2026-05-09T13:00:00Z",
      session_id: h.client.state.id,
      payload: {},
    };
    await h.clientTransport.send(frame);
    const n = await awaitNonNull(() => nack);
    expect(n.code).toBe("UNIMPLEMENTED");
    await h.close();
  });

  it("unknown namespaced type with extensions.optional=true ⇒ silently dropped (no nack)", async () => {
    const h = makePairedHarness();
    await h.connect();
    let receivedNack = false;
    h.client.on("nack", () => {
      receivedNack = true;
    });
    const frame: WireFrame = {
      arcp: PROTOCOL_VERSION,
      id: "msg_optional_ext",
      type: "arcpx.acme.frobnicate.v1",
      timestamp: "2026-05-09T13:00:00Z",
      session_id: h.client.state.id,
      payload: {},
      extensions: { optional: true },
    };
    await h.clientTransport.send(frame);
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(receivedNack).toBe(false);
    await h.close();
  });

  it("malformed envelope payload triggers a nack INVALID_ARGUMENT", async () => {
    const h = makePairedHarness();
    await h.connect();
    let nack: { code?: string } | null = null;
    h.client.on("nack", (env: Envelope) => {
      if (env.type === "nack") nack = { code: env.payload.code };
    });
    const frame: WireFrame = {
      arcp: PROTOCOL_VERSION,
      id: "msg_bad_payload",
      type: "tool.invoke",
      timestamp: "2026-05-09T13:00:00Z",
      session_id: h.client.state.id,
      payload: {
        /* missing `tool` */
      },
    };
    await h.clientTransport.send(frame);
    const n = await awaitNonNull(() => nack);
    expect(n.code).toBe("INVALID_ARGUMENT");
    await h.close();
  });
});
