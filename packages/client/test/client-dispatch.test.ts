import { buildEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import { ARCPError } from "@agentruntimecontrolprotocol/core/errors";
import type { Logger } from "@agentruntimecontrolprotocol/core/logger";
import type {
  Envelope,
  JobAcceptedPayload,
  JobErrorPayload,
  JobEventPayload,
  JobResultPayload,
  JobSubscribedPayload,
  SessionJobsPayload,
  SessionWelcomePayload,
} from "@agentruntimecontrolprotocol/core/messages";
import { SessionState } from "@agentruntimecontrolprotocol/core/state";
import { Deferred } from "@agentruntimecontrolprotocol/core/util";
import { describe, expect, it, vi } from "vitest";

import type { DispatchTarget } from "../src/client-dispatch.js";
import { dispatchEnvelope } from "../src/client-dispatch.js";
import type { InvocationState } from "../src/client-handle.js";

function makeLogger(): Logger {
  return {
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    level: "info",
    silent: false,
    bindings: vi.fn(),
    isLevelEnabled: vi.fn(),
    flush: vi.fn(),
    [Symbol.for("pino.serializers")]: {},
  } as unknown as Logger;
}

function makeInvocation(): InvocationState {
  const acceptance = new Deferred<JobAcceptedPayload>();
  const completion = new Deferred<JobResultPayload>();
  completion.promise.catch(() => undefined);
  acceptance.promise.catch(() => undefined);
  return {
    jobId: null,
    lease: null,
    agent: undefined,
    leaseConstraints: undefined,
    budget: undefined,
    credentials: undefined,
    traceId: undefined,
    events: [],
    acceptance,
    completion,
    chunks: new Map(),
  };
}

function makeTarget(): {
  target: DispatchTarget;
  sent: Envelope[];
  state: SessionState;
  logger: Logger;
} {
  const sent: Envelope[] = [];
  const state = new SessionState();
  const transport = {
    closed: false,
    send: vi.fn(async (frame: Envelope) => {
      sent.push(frame);
    }),
  };
  const logger = makeLogger();
  const target = {
    logger,
    state,
    handshake: null,
    invocationsByOriginId: new Map(),
    invocationsByJobId: new Map(),
    pendingAccepts: [],
    pendingLists: new Map(),
    pendingSubscribes: new Map(),
    handlers: new Map(),
    transport: transport as unknown as DispatchTarget["transport"],
    observeEventSeq: vi.fn(),
  } as unknown as DispatchTarget;
  return { target, sent, state, logger };
}

describe("dispatchEnvelope", () => {
  it("logs malformed frames and returns early", async () => {
    const { target, logger } = makeTarget();
    await dispatchEnvelope(target, {} as never);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("resolves the handshake on session.welcome", async () => {
    const { target, state } = makeTarget();
    const handshake = new Deferred<SessionWelcomePayload>();
    (target as unknown as { handshake: Deferred<SessionWelcomePayload> | null }).handshake =
      handshake;
    const frame = buildEnvelope({
      id: "msg_1",
      type: "session.welcome",
      payload: {
        runtime: { name: "test-runtime", version: "0.1.0" },
        resume_token: "rt_abc",
        resume_window_sec: 60,
        capabilities: { encodings: ["json"] },
      },
      optional: { session_id: "sess_1" as never },
    });
    await dispatchEnvelope(target, frame);
    await expect(handshake.promise).resolves.toMatchObject({
      resume_token: "rt_abc",
    });
    expect(state.id).toBe("sess_1");
  });

  it("rejects the handshake and in-flight requests on session.error", async () => {
    const { target } = makeTarget();
    const handshake = new Deferred<SessionWelcomePayload>();
    const list = new Deferred<SessionJobsPayload>();
    const subscribed = new Deferred<JobSubscribedPayload>();
    const invocation = makeInvocation();
    (target as unknown as { handshake: Deferred<SessionWelcomePayload> | null }).handshake =
      handshake;
    target.pendingLists.set("msg_list", list);
    target.pendingSubscribes.set("job_1", subscribed);
    target.invocationsByOriginId.set("msg_submit", invocation);
    target.pendingAccepts.push(invocation);
    const frame = buildEnvelope({
      id: "msg_err",
      type: "session.error",
      payload: {
        code: "INVALID_REQUEST",
        message: "boom",
        retryable: false,
      },
      optional: { session_id: "sess_1" as never },
    });
    await dispatchEnvelope(target, frame);
    await expect(handshake.promise).rejects.toBeInstanceOf(ARCPError);
    await expect(list.promise).rejects.toBeInstanceOf(ARCPError);
    await expect(subscribed.promise).rejects.toBeInstanceOf(ARCPError);
    await expect(invocation.acceptance.promise).rejects.toBeInstanceOf(ARCPError);
    await expect(invocation.completion.promise).rejects.toBeInstanceOf(ARCPError);
  });

  it("replies to session.ping with a session.pong", async () => {
    const { target, sent, state } = makeTarget();
    state.assignId("sess_1" as never);
    state.transition("accepted");
    const frame = buildEnvelope({
      id: "msg_ping",
      type: "session.ping",
      payload: { nonce: "nonce-1", sent_at: new Date().toISOString() },
      optional: { session_id: "sess_1" as never },
    });
    await dispatchEnvelope(target, frame);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type).toBe("session.pong");
  });

  it("resolves pending list_jobs and subscribe requests", async () => {
    const { target } = makeTarget();
    const list = new Deferred<SessionJobsPayload>();
    target.pendingLists.set("msg_list", list);
    await dispatchEnvelope(
      target,
      buildEnvelope({
        id: "msg_list",
        type: "session.jobs",
        payload: {
          request_id: "msg_list",
          jobs: [],
          next_cursor: null,
        },
        optional: { session_id: "sess_1" as never },
      }),
    );
    await dispatchEnvelope(
      target,
      buildEnvelope({
        id: "msg_sub",
        type: "job.subscribed",
        payload: {
          job_id: "job_1",
          subscribed_from: 1,
          replayed: false,
        },
        optional: { session_id: "sess_1" as never, job_id: "job_1" as never },
      }),
    );
    await expect(list.promise).resolves.toMatchObject({ request_id: "msg_list" });
  });

  it("binds accepted jobs and accumulates result chunks", async () => {
    const { target } = makeTarget();
    const invocation = makeInvocation();
    target.pendingAccepts.push(invocation);
    const accepted = buildEnvelope({
      id: "msg_acc",
      type: "job.accepted",
      payload: {
        job_id: "job_1",
        lease: {},
        agent: "echo",
        accepted_at: new Date().toISOString(),
      },
      optional: { session_id: "sess_1" as never, job_id: "job_1" as never },
    });
    await dispatchEnvelope(target, accepted);
    expect(target.invocationsByJobId.has("job_1")).toBe(true);
    await expect(invocation.acceptance.promise).resolves.toMatchObject({
      job_id: "job_1",
    });

    await dispatchEnvelope(
      target,
      buildEnvelope({
        id: "msg_evt",
        type: "job.event",
        optional: {
          session_id: "sess_1" as never,
          job_id: "job_1" as never,
          event_seq: 7 as never,
        },
        payload: {
          kind: "result_chunk",
          ts: new Date().toISOString(),
          body: {
            result_id: "res_1",
            chunk_seq: 0,
            data: "hello",
            encoding: "utf8",
            more: true,
          },
        },
      }),
    );
    expect(invocation.events).toHaveLength(1);
    expect(invocation.chunks.get("res_1")).toHaveLength(1);
  });

  it("settles the completion on job.result and job.error", async () => {
    const { target } = makeTarget();
    const success = makeInvocation();
    const failed = makeInvocation();
    target.invocationsByJobId.set("job_s", success);
    target.invocationsByJobId.set("job_f", failed);

    await dispatchEnvelope(
      target,
      buildEnvelope({
        id: "msg_result",
        type: "job.result",
        optional: {
          session_id: "sess_1" as never,
          job_id: "job_s" as never,
          event_seq: 9 as never,
        },
        payload: { final_status: "success", result: { ok: true } },
      }),
    );
    await dispatchEnvelope(
      target,
      buildEnvelope({
        id: "msg_error",
        type: "job.error",
        optional: {
          session_id: "sess_1" as never,
          job_id: "job_f" as never,
          event_seq: 10 as never,
        },
        payload: {
          final_status: "error",
          code: "INTERNAL_ERROR",
          message: "boom",
          retryable: true,
        } satisfies JobErrorPayload,
      }),
    );

    await expect(success.completion.promise).resolves.toMatchObject({
      final_status: "success",
    });
    await expect(failed.completion.promise).rejects.toBeInstanceOf(ARCPError);
  });

  it("invokes registered handlers and logs handler errors", async () => {
    const { target, logger } = makeTarget();
    const handler = vi.fn(async () => undefined);
    target.handlers.set("job.event", handler);
    await dispatchEnvelope(
      target,
      buildEnvelope({
        id: "msg_evt",
        type: "job.event",
        optional: {
          session_id: "sess_1" as never,
          job_id: "job_1" as never,
          event_seq: 11 as never,
        },
        payload: {
          kind: "log",
          ts: new Date().toISOString(),
          body: { hello: "world" },
        } satisfies JobEventPayload,
      }),
    );
    expect(handler).toHaveBeenCalled();

    target.handlers.set("job.event", vi.fn(async () => {
      throw new Error("handler blew up");
    }));
    await dispatchEnvelope(
      target,
      buildEnvelope({
        id: "msg_evt_2",
        type: "job.event",
        optional: {
          session_id: "sess_1" as never,
          job_id: "job_1" as never,
          event_seq: 12 as never,
        },
        payload: {
          kind: "log",
          ts: new Date().toISOString(),
          body: { hello: "again" },
        } satisfies JobEventPayload,
      }),
    );
    expect(logger.error).toHaveBeenCalled();
  });
});
