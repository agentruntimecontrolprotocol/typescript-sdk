import type { BaseEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import { silentLogger } from "@agentruntimecontrolprotocol/core/logger";
import type { SessionWelcomePayload } from "@agentruntimecontrolprotocol/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientLiveness, type LivenessDeps } from "../src/client-liveness.js";
import type { ARCPClientOptions, SessionBrokenInfo } from "../src/types.js";

interface Recorded {
  ack: number[];
  broken: SessionBrokenInfo[];
  heartbeatLost: number;
}

function makeDeps(
  overrides: {
    options?: Partial<ARCPClientOptions>;
    hasFeature?: (name: string) => boolean;
  } = {},
): { deps: LivenessDeps; calls: Recorded } {
  const calls: Recorded = { ack: [], broken: [], heartbeatLost: 0 };
  const options: ARCPClientOptions = {
    client: { name: "c", version: "1" },
    authScheme: "bearer",
    token: "t",
    onSessionBroken: (info) => calls.broken.push(info),
    onHeartbeatLost: () => {
      calls.heartbeatLost += 1;
    },
    ...overrides.options,
  };
  const deps: LivenessDeps = {
    logger: silentLogger,
    options,
    hasFeature: overrides.hasFeature ?? (() => true),
    sendAck: async (seq) => {
      calls.ack.push(seq);
    },
    getSessionId: () => "sess_1",
    getResumeToken: () => "rt_x",
  };
  return { deps, calls };
}

const evt = (event_seq: number): BaseEnvelope =>
  ({ event_seq }) as unknown as BaseEnvelope;

describe("ClientLiveness §8.3 event_seq gap detection", () => {
  it("marks the session broken on a gap and notifies with cursor + token", () => {
    const { deps, calls } = makeDeps();
    const liveness = new ClientLiveness(deps);
    liveness.observeEventSeq(evt(1));
    liveness.observeEventSeq(evt(5));
    expect(liveness.isSessionBroken).toBe(true);
    expect(calls.broken).toHaveLength(1);
    expect(calls.broken[0]).toMatchObject({
      lastEventSeq: 1,
      receivedEventSeq: 5,
      sessionId: "sess_1",
      resumeToken: "rt_x",
    });
  });

  it("does not mark broken for contiguous events", () => {
    const { deps, calls } = makeDeps();
    const liveness = new ClientLiveness(deps);
    for (let s = 1; s <= 5; s += 1) liveness.observeEventSeq(evt(s));
    expect(liveness.isSessionBroken).toBe(false);
    expect(liveness.lastEventSeqObserved).toBe(5);
    expect(calls.broken).toHaveLength(0);
  });

  it("seedFromResume prevents replayed events from being read as a gap", () => {
    const { deps, calls } = makeDeps();
    const liveness = new ClientLiveness(deps);
    liveness.seedFromResume(10);
    liveness.observeEventSeq(evt(11));
    expect(liveness.isSessionBroken).toBe(false);
    expect(liveness.lastEventSeqObserved).toBe(11);
    expect(calls.broken).toHaveLength(0);
  });
});

describe("ClientLiveness §6.5 auto-ack", () => {
  it("flushes an ack once minSeqDelta new events accumulate", async () => {
    const { deps, calls } = makeDeps({
      options: { autoAck: { minSeqDelta: 2, intervalMs: 5 } },
    });
    const liveness = new ClientLiveness(deps);
    liveness.observeEventSeq(evt(1));
    liveness.observeEventSeq(evt(2));
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(calls.ack).toContain(2);
  });

  it("does not auto-ack when auto-ack is disabled", async () => {
    const { deps, calls } = makeDeps();
    const liveness = new ClientLiveness(deps);
    for (let s = 1; s <= 50; s += 1) liveness.observeEventSeq(evt(s));
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(calls.ack).toHaveLength(0);
  });
});

describe("ClientLiveness §6.4 heartbeat watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onHeartbeatLost after two silent intervals", () => {
    vi.useFakeTimers();
    const { deps, calls } = makeDeps();
    const liveness = new ClientLiveness(deps);
    liveness.start({ heartbeat_interval_sec: 1 } as SessionWelcomePayload);
    vi.advanceTimersByTime(2001);
    expect(calls.heartbeatLost).toBe(1);
  });

  it("touch() re-arms the watchdog, deferring the loss", () => {
    vi.useFakeTimers();
    const { deps, calls } = makeDeps();
    const liveness = new ClientLiveness(deps);
    liveness.start({ heartbeat_interval_sec: 1 } as SessionWelcomePayload);
    vi.advanceTimersByTime(1500);
    liveness.touch();
    vi.advanceTimersByTime(1500);
    expect(calls.heartbeatLost).toBe(0);
    vi.advanceTimersByTime(600);
    expect(calls.heartbeatLost).toBe(1);
  });

  it("clear() cancels the watchdog", () => {
    vi.useFakeTimers();
    const { deps, calls } = makeDeps();
    const liveness = new ClientLiveness(deps);
    liveness.start({ heartbeat_interval_sec: 1 } as SessionWelcomePayload);
    liveness.clear();
    vi.advanceTimersByTime(10_000);
    expect(calls.heartbeatLost).toBe(0);
  });
});
