import { SessionState } from "@agentruntimecontrolprotocol/core/state";
import { newSessionId } from "@agentruntimecontrolprotocol/core/util";
import { describe, expect, it, vi } from "vitest";

import { handleResume } from "../src/server-resume.js";
import { ResumeStore, newResumeToken } from "../src/stores.js";

function makeCtx() {
  const state = new SessionState();
  const sent: unknown[] = [];
  const transported: unknown[] = [];
  return {
    state,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
    transport: {
      send: vi.fn(async (frame: unknown) => {
        transported.push(frame);
      }),
    },
    send: vi.fn(async (frame: unknown) => {
      sent.push(frame);
    }),
    setEventSeq: vi.fn(),
    startHeartbeat: vi.fn(),
    emitSessionError: vi.fn(async () => undefined),
    assignNegotiatedFeatures: vi.fn(),
    hasFeature: vi.fn(() => true),
    sent,
    transported,
  };
}

function makeServer() {
  const resumeStore = new ResumeStore();
  const eventLog = {
    getSeqBounds: vi.fn(async (_sessionId: string) => ({ min: 2, max: 3 })),
    readSinceSeq: vi.fn(async (_sessionId: string, _after: number) => [
      {
        id: "msg_1",
        type: "job.event",
        session_id: "sess_1",
        job_id: "job_1",
        event_seq: 2,
        payload: {
          kind: "log",
          ts: new Date().toISOString(),
          body: { note: "replay" },
        },
      },
      {
        id: "msg_2",
        type: "job.result",
        session_id: "sess_1",
        job_id: "job_1",
        event_seq: 3,
        payload: { final_status: "success", result: { ok: true } },
      },
    ]),
  };
  return {
    options: {
      runtime: { name: "test-runtime", version: "0.1.0" },
      capabilities: { encodings: ["json"] },
      resumeWindowSeconds: 1,
    },
    sessions: new Map<string, unknown>(),
    resumeStore,
    eventLog,
    makeNegotiatedCapabilities: vi.fn(() => ({ encodings: ["json"] })),
    buildWelcomePayload: vi.fn((_ctx, caps, args) => ({
      runtime: { name: "test-runtime", version: "0.1.0" },
      resume_token: args.resumeToken,
      resume_window_sec: args.resumeWindowSec,
      capabilities: caps,
    })),
    registerPostHandshakeHandlers: vi.fn(),
    bindLogger: vi.fn(),
  };
}

describe("handleResume", () => {
  it("rejects when resume payload is missing", async () => {
    const server = makeServer();
    const ctx = makeCtx();
    await handleResume({
      server: server as never,
      ctx: ctx as never,
      identity: { principal: "alice" },
      payload: {
        client: { name: "client", version: "0.1.0" },
        capabilities: { encodings: ["json"] },
        auth: { scheme: "bearer", token: "tok" },
      } as never,
    });
    expect(ctx.emitSessionError).toHaveBeenCalled();
  });

  it("rotates the token, replays events, and starts the heartbeat", async () => {
    const server = makeServer();
    const ctx = makeCtx();
    const sessionId = newSessionId();
    const token = newResumeToken();
    server.resumeStore.set(sessionId, {
      sessionId,
      resumeToken: token,
      expiresAt: Date.now() + 60_000,
    });
    server.sessions.set(sessionId, { old: true });

    await handleResume({
      server: server as never,
      ctx: ctx as never,
      identity: { principal: "alice" },
      payload: {
        client: { name: "client", version: "0.1.0" },
        capabilities: { encodings: ["json"] },
        auth: { scheme: "bearer", token: "tok" },
        resume: {
          session_id: sessionId,
          resume_token: token,
          last_event_seq: 1,
        },
      } as never,
    });

    expect(server.sessions.get(sessionId)).toBe(ctx);
    expect(server.resumeStore.get(sessionId)?.resumeToken).not.toBe(token);
    expect(server.registerPostHandshakeHandlers).toHaveBeenCalledWith(ctx);
    expect(server.bindLogger).toHaveBeenCalledWith(ctx, "client");
    expect(ctx.startHeartbeat).toHaveBeenCalled();
    expect(ctx.send).toHaveBeenCalled();
    expect(ctx.transport.send).toHaveBeenCalledTimes(2);
    expect(ctx.setEventSeq).toHaveBeenCalledWith(3);
  });

  it("rejects a wrong resume_token of equal length (constant-time path)", async () => {
    const server = makeServer();
    const ctx = makeCtx();
    const sessionId = newSessionId();
    const token = newResumeToken();
    server.resumeStore.set(sessionId, {
      sessionId,
      resumeToken: token,
      expiresAt: Date.now() + 60_000,
    });
    // Same length as the real token but every byte differs.
    const wrongToken = `${"x".repeat(token.length - 1)}y`;
    expect(wrongToken).toHaveLength(token.length);

    await handleResume({
      server: server as never,
      ctx: ctx as never,
      identity: { principal: "alice" },
      payload: {
        client: { name: "client", version: "0.1.0" },
        capabilities: { encodings: ["json"] },
        auth: { scheme: "bearer", token: "tok" },
        resume: {
          session_id: sessionId,
          resume_token: wrongToken,
          last_event_seq: 1,
        },
      } as never,
    });

    expect(ctx.emitSessionError).toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
    // The valid token in the store must be unchanged (no rotation on reject).
    expect(server.resumeStore.get(sessionId)?.resumeToken).toBe(token);
  });

  it("accepts the correct resume_token", async () => {
    const server = makeServer();
    const ctx = makeCtx();
    const sessionId = newSessionId();
    const token = newResumeToken();
    server.resumeStore.set(sessionId, {
      sessionId,
      resumeToken: token,
      expiresAt: Date.now() + 60_000,
    });

    await handleResume({
      server: server as never,
      ctx: ctx as never,
      identity: { principal: "alice" },
      payload: {
        client: { name: "client", version: "0.1.0" },
        capabilities: { encodings: ["json"] },
        auth: { scheme: "bearer", token: "tok" },
        resume: {
          session_id: sessionId,
          resume_token: token,
          last_event_seq: 1,
        },
      } as never,
    });

    expect(ctx.emitSessionError).not.toHaveBeenCalled();
    expect(ctx.send).toHaveBeenCalled();
  });

  it("rejects resume when the buffer exceeds the replay cap (issue #141)", async () => {
    const server = makeServer();
    const ctx = makeCtx();
    const sessionId = newSessionId();
    const token = newResumeToken();
    server.resumeStore.set(sessionId, {
      sessionId,
      resumeToken: token,
      expiresAt: Date.now() + 60_000,
    });
    // The true tail (max=20_000) is far beyond the contiguous slice the capped
    // read returns (ending at event_seq 3). Replaying only the slice would set
    // event_seq to 3 and the next live event would collide with a persisted row.
    server.eventLog.getSeqBounds = vi.fn(async () => ({ min: 1, max: 20_000 }));
    server.eventLog.readSinceSeq = vi.fn(async () =>
      [1, 2, 3].map((seq) => ({
        id: `msg_${seq}`,
        type: "job.event",
        session_id: sessionId,
        job_id: "job_1",
        event_seq: seq,
        payload: { kind: "log", ts: new Date().toISOString(), body: {} },
      })),
    ) as never;

    await handleResume({
      server: server as never,
      ctx: ctx as never,
      identity: { principal: "alice" },
      payload: {
        client: { name: "client", version: "0.1.0" },
        capabilities: { encodings: ["json"] },
        auth: { scheme: "bearer", token: "tok" },
        resume: {
          session_id: sessionId,
          resume_token: token,
          last_event_seq: 0,
        },
      } as never,
    });

    expect(ctx.emitSessionError).toHaveBeenCalled();
    // The resume is rejected: nothing replayed, no truncated cursor written.
    expect(ctx.send).not.toHaveBeenCalled();
    expect(ctx.setEventSeq).not.toHaveBeenCalled();
  });

  it("rejects when resume replay fails before welcome", async () => {
    const server = makeServer();
    const ctx = makeCtx();
    const sessionId = newSessionId();
    const token = newResumeToken();
    server.resumeStore.set(sessionId, {
      sessionId,
      resumeToken: token,
      expiresAt: Date.now() + 60_000,
    });
    server.eventLog.readSinceSeq = vi.fn(async () => {
      throw new Error("boom");
    });

    await handleResume({
      server: server as never,
      ctx: ctx as never,
      identity: { principal: "alice" },
      payload: {
        client: { name: "client", version: "0.1.0" },
        capabilities: { encodings: ["json"] },
        auth: { scheme: "bearer", token: "tok" },
        resume: {
          session_id: sessionId,
          resume_token: token,
          last_event_seq: 1,
        },
      } as never,
    });

    expect(ctx.logger.warn).toHaveBeenCalled();
    expect(ctx.emitSessionError).toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
    expect(server.registerPostHandshakeHandlers).not.toHaveBeenCalled();
  });
});
