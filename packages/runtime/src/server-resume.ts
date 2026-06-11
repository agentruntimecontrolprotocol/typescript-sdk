import { timingSafeEqual } from "node:crypto";

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

/**
 * Maximum number of buffered events replayed in a single resume. A session
 * whose buffer extends beyond this many events past the cursor cannot be
 * replayed gap-free in one pass, so the resume is rejected rather than
 * silently truncated (§6.3, §8.3).
 */
const RESUME_REPLAY_CAP = 10_000;

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
  // §14 — the resume token is a session secret that grants full session
  // takeover. Compare it in constant time so an attacker cannot recover a
  // valid token by measuring how early a plain `!==` short-circuits. Guard the
  // missing-record case first and only compare equal-length buffers (a length
  // mismatch is itself an immediate, non-secret-dependent rejection).
  if (
    record === undefined ||
    !secretEquals(record.resumeToken, resume.resume_token)
  ) {
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

/**
 * Constant-time comparison of two session secrets (§14). Returns `false`
 * immediately on a length mismatch (length is not secret), otherwise defers to
 * {@link timingSafeEqual} so the comparison time does not leak how many leading
 * bytes matched.
 */
function secretEquals(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
      RESUME_REPLAY_CAP,
    );
    validateResumeCoverage(bounds, replayed, resume.last_event_seq);
    assertFullReplay(bounds, replayed);
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

/**
 * Reject a resume whose replay was truncated by {@link RESUME_REPLAY_CAP}.
 *
 * `readSinceSeq` returns at most `RESUME_REPLAY_CAP` events. `validateResumeCoverage`
 * only proves the *returned* slice is contiguous, so a session with more than
 * the cap of events past the cursor passes coverage while the tail
 * `(highestReplayed, bounds.max]` is silently dropped. Replaying the truncated
 * slice and then setting `event_seq` to that lower value makes the next live
 * emission re-allocate a seq already present in the log (a duplicate-`event_seq`
 * collision under `INSERT OR IGNORE`), corrupting future resumes. If the capped
 * read did not reach the buffer's true tail, fail the resume instead (§8.3).
 */
function assertFullReplay(
  bounds: EventSeqBounds,
  replayed: readonly BaseEnvelope[],
): void {
  if (bounds.max === null) return;
  let highest = 0;
  for (const env of replayed) {
    if (env.event_seq !== undefined && env.event_seq > highest) {
      highest = env.event_seq;
    }
  }
  if (bounds.max > highest) {
    throw new ResumeWindowExpiredError(
      "Resume buffer exceeds the replay cap; cannot replay without a gap",
    );
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
