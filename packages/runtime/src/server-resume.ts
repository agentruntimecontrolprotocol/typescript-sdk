import type { SessionId } from "@agentruntimecontrolprotocol/core";
import type { BearerIdentity } from "@agentruntimecontrolprotocol/core/auth";
import type { BaseEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import { buildEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import {
  InvalidRequestError,
  ResumeWindowExpiredError,
} from "@agentruntimecontrolprotocol/core/errors";
import type { SessionHelloPayload } from "@agentruntimecontrolprotocol/core/messages";
import type { EventSeqBounds } from "@agentruntimecontrolprotocol/core/store";
import { newMessageId } from "@agentruntimecontrolprotocol/core/util";

import type { ARCPServer } from "./server.js";
import type { SessionContext } from "./session-context.js";
import { newResumeToken } from "./stores.js";

const DEFAULT_RESUME_WINDOW_SECONDS = 600;

export interface HandleResumeArgs {
  server: ARCPServer;
  ctx: SessionContext;
  identity: BearerIdentity;
  payload: SessionHelloPayload;
}

export async function handleResume(args: HandleResumeArgs): Promise<void> {
  const { server, ctx, identity, payload } = args;
  const resume = payload.resume;
  if (resume === undefined) {
    await ctx.emitSessionError(
      new InvalidRequestError("handleResume called without resume payload"),
    );
    return;
  }
  if (ctx.state.id === undefined) ctx.state.assignId(resume.session_id);
  if (!(await validateResumeRecord(server, ctx, resume))) return;
  const replayed = await readResumeEvents(server, ctx, resume);
  if (replayed === null) return;
  rebindResumedSession({ server, ctx, identity, payload });
  const freshToken = rotateResumeToken(server, resume.session_id);
  await sendResumeWelcome({
    server,
    ctx,
    freshToken,
    sessionId: resume.session_id,
  });
  await replayResumeEvents(ctx, resume, replayed);
  ctx.logger.info(
    { session_id: resume.session_id, replayed_from: resume.last_event_seq },
    "session resumed",
  );
  server.registerPostHandshakeHandlers(ctx);
  ctx.startHeartbeat();
}

function rebindResumedSession(args: HandleResumeArgs): void {
  const { server, ctx, identity, payload } = args;
  const resume = payload.resume;
  if (resume === undefined) return;
  const sessionId = resume.session_id;
  // Detach any in-memory session bound to that id (e.g., a dropped socket).
  const prior = server.sessions.get(sessionId);
  if (prior !== undefined && prior !== ctx) server.sessions.delete(sessionId);
  ctx.state.assignId(sessionId);
  ctx.state.assignIdentity(identity);
  const negotiated = server.makeNegotiatedCapabilities(payload, ctx);
  ctx.state.assignCapabilities(negotiated);
  server.bindLogger(ctx, payload.client.name);
}

async function validateResumeRecord(
  server: ARCPServer,
  ctx: SessionContext,
  resume: NonNullable<SessionHelloPayload["resume"]>,
): Promise<boolean> {
  const record = server.resumeStore.get(resume.session_id);
  if (record?.resumeToken !== resume.resume_token) {
    await ctx.emitSessionError(
      new ResumeWindowExpiredError("Invalid or unknown resume_token"),
    );
    return false;
  }
  if (record.expiresAt < Date.now()) {
    server.resumeStore.delete(resume.session_id);
    await ctx.emitSessionError(
      new ResumeWindowExpiredError("Resume window has expired"),
    );
    return false;
  }
  return true;
}

function rotateResumeToken(
  server: ARCPServer,
  sessionId: SessionId,
): ReturnType<typeof newResumeToken> {
  const resumeWindowSec =
    server.options.resumeWindowSeconds ?? DEFAULT_RESUME_WINDOW_SECONDS;
  const freshToken = newResumeToken();
  server.resumeStore.set(sessionId, {
    sessionId,
    resumeToken: freshToken,
    expiresAt: Date.now() + resumeWindowSec * 1000,
  });
  return freshToken;
}

interface SendResumeWelcomeArgs {
  server: ARCPServer;
  ctx: SessionContext;
  freshToken: ReturnType<typeof newResumeToken>;
  sessionId: SessionId;
}

async function sendResumeWelcome(args: SendResumeWelcomeArgs): Promise<void> {
  const { server, ctx, freshToken, sessionId } = args;
  const resumeWindowSec =
    server.options.resumeWindowSeconds ?? DEFAULT_RESUME_WINDOW_SECONDS;
  const welcome = server.buildWelcomePayload(
    ctx,
    ctx.state.capabilities ?? {},
    {
      resumeToken: freshToken,
      resumeWindowSec,
    },
  );
  ctx.state.transition("accepted");
  server.sessions.set(sessionId, ctx);
  await ctx.send(
    buildEnvelope({
      id: newMessageId(),
      type: "session.welcome" as const,
      payload: welcome,
      optional: { session_id: sessionId },
    }),
  );
}

async function replayResumeEvents(
  ctx: SessionContext,
  resume: NonNullable<SessionHelloPayload["resume"]>,
  replayed: readonly BaseEnvelope[],
): Promise<void> {
  let highest = resume.last_event_seq;
  for (const env of replayed) {
    if (env.event_seq !== undefined && env.event_seq > highest) {
      highest = env.event_seq;
    }
    await ctx.transport.send(env);
  }
  ctx.setEventSeq(highest);
}

async function readResumeEvents(
  server: ARCPServer,
  ctx: SessionContext,
  resume: NonNullable<SessionHelloPayload["resume"]>,
): Promise<readonly BaseEnvelope[] | null> {
  try {
    const bounds = await server.eventLog.getSeqBounds(resume.session_id);
    const replayed = await server.eventLog.readSinceSeq(
      resume.session_id,
      resume.last_event_seq,
      10_000,
    );
    validateResumeCoverage(bounds, replayed, resume.last_event_seq);
    return replayed;
  } catch (error) {
    ctx.logger.warn({ err: error }, "resume replay unavailable");
    await ctx.emitSessionError(
      error instanceof ResumeWindowExpiredError
        ? error
        : new ResumeWindowExpiredError("Resume buffer no longer covers cursor"),
    );
    return null;
  }
}

function validateResumeCoverage(
  bounds: EventSeqBounds,
  replayed: readonly BaseEnvelope[],
  lastEventSeq: number,
): void {
  if (bounds.max === null) {
    if (lastEventSeq > 0) {
      throw new ResumeWindowExpiredError(
        "Resume buffer no longer covers last_event_seq",
      );
    }
    return;
  }
  if (lastEventSeq > bounds.max) {
    throw new ResumeWindowExpiredError(
      "last_event_seq is beyond the buffered event window",
    );
  }
  if (bounds.min !== null && lastEventSeq < bounds.min - 1) {
    throw new ResumeWindowExpiredError(
      "Resume buffer no longer covers last_event_seq",
    );
  }
  let expected = lastEventSeq + 1;
  for (const env of replayed) {
    if (env.event_seq === undefined) continue;
    if (env.event_seq !== expected) {
      throw new ResumeWindowExpiredError(
        "Resume buffer contains an event_seq gap",
      );
    }
    expected += 1;
  }
}
