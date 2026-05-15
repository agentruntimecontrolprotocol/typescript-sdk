import {
  type BaseEnvelope,
  buildEnvelope,
  RoundTripEnvelopeSchema,
} from "@arcp/core/envelope";
import { ARCPError } from "@arcp/core/errors";
import type { Logger } from "@arcp/core/logger";
import {
  type Envelope,
  EnvelopeSchema,
  jobErrorToErrorPayload,
  type ResultChunkBody,
} from "@arcp/core/messages";
import type { SessionState } from "@arcp/core/state";
import type { Transport, WireFrame } from "@arcp/core/transport";
import { type Deferred, newMessageId } from "@arcp/core/util";

import type { InvocationState } from "./client-handle.js";

/** Mutable bits a dispatch routine needs to read/write. */
export interface DispatchTarget {
  readonly logger: Logger;
  readonly state: SessionState;
  readonly handshake: Deferred<unknown> | null;
  readonly invocationsByOriginId: Map<string, InvocationState>;
  readonly invocationsByJobId: Map<string, InvocationState>;
  readonly pendingAccepts: InvocationState[];
  readonly pendingLists: Map<string, Deferred<unknown>>;
  readonly pendingSubscribes: Map<string, Deferred<unknown>>;
  readonly handlers: Map<string, (env: Envelope) => Promise<void>>;
  readonly transport: Transport | null;
  observeEventSeq(env: Envelope): void;
}

export async function dispatchEnvelope(
  target: DispatchTarget,
  frame: WireFrame,
): Promise<void> {
  const parsed = safeParseRoundTrip(target, frame);
  if (parsed === null) return;
  if (handleHandshakeFrame(target, parsed)) return;
  if (await handlePingPong(target, parsed)) return;

  const env = validateInbound(target, parsed);
  if (env === null) return;
  target.observeEventSeq(env);
  if (handleSessionJobs(target, env)) return;
  if (handleJobSubscribed(target, env)) return;
  routeJobEvent(target, env);
  await invokeUserHandler(target, env);
}

function safeParseRoundTrip(
  target: DispatchTarget,
  frame: WireFrame,
): BaseEnvelope | null {
  try {
    return RoundTripEnvelopeSchema.parse(frame);
  } catch (error) {
    target.logger.warn({ err: error }, "client received malformed frame");
    return null;
  }
}

function handleHandshakeFrame(
  target: DispatchTarget,
  parsed: BaseEnvelope,
): boolean {
  if (parsed.type === "session.welcome") {
    onSessionWelcome(target, parsed);
    return true;
  }
  if (parsed.type === "session.error") {
    onSessionError(target, parsed);
    return true;
  }
  return false;
}

function onSessionWelcome(target: DispatchTarget, parsed: BaseEnvelope): void {
  const result = EnvelopeSchema.safeParse(parsed);
  if (!result.success || result.data.type !== "session.welcome") return;
  // session_id is typed as required by the schema, but we keep the runtime
  // check in case the server omits it on the wire.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (result.data.session_id !== undefined) {
    try {
      target.state.assignId(result.data.session_id);
    } catch {
      // ignore — likely a resume on the same id
    }
  }
  target.handshake?.resolve(result.data.payload);
}

function onSessionError(target: DispatchTarget, parsed: BaseEnvelope): void {
  const result = EnvelopeSchema.safeParse(parsed);
  if (!result.success || result.data.type !== "session.error") return;
  const err = ARCPError.fromPayload(result.data.payload);
  if (target.handshake !== null && !target.handshake.settled) {
    target.handshake.reject(err);
  }
  rejectAllInvocations(target, err);
  rejectAllPendingMaps(target, err);
}

function rejectAllInvocations(target: DispatchTarget, err: ARCPError): void {
  for (const inv of target.invocationsByOriginId.values()) {
    if (!inv.acceptance.settled) inv.acceptance.reject(err);
    if (!inv.completion.settled) inv.completion.reject(err);
  }
}

function rejectAllPendingMaps(target: DispatchTarget, err: ARCPError): void {
  for (const d of target.pendingLists.values()) if (!d.settled) d.reject(err);
  for (const d of target.pendingSubscribes.values()) {
    if (!d.settled) d.reject(err);
  }
}

async function handlePingPong(
  target: DispatchTarget,
  parsed: BaseEnvelope,
): Promise<boolean> {
  if (parsed.type === "session.ping") {
    await sendPong(target, parsed);
    return true;
  }
  if (parsed.type === "session.pong") return true;
  return false;
}

async function sendPong(
  target: DispatchTarget,
  parsed: BaseEnvelope,
): Promise<void> {
  const result = EnvelopeSchema.safeParse(parsed);
  if (!result.success || result.data.type !== "session.ping") return;
  const sessionId = target.state.id;
  if (sessionId === undefined || target.transport === null) return;
  const pongEnv = buildEnvelope({
    id: newMessageId(),
    type: "session.pong" as const,
    payload: {
      ping_nonce: result.data.payload.nonce,
      received_at: new Date().toISOString(),
    },
    optional: { session_id: sessionId },
  });
  try {
    await target.transport.send(pongEnv);
  } catch {
    // best-effort
  }
}

function validateInbound(
  target: DispatchTarget,
  parsed: BaseEnvelope,
): Envelope | null {
  const result = EnvelopeSchema.safeParse(parsed);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  target.logger.warn(
    { type: parsed.type, code: issue?.code, message: issue?.message },
    "client received unparseable envelope",
  );
  return null;
}

function handleSessionJobs(target: DispatchTarget, env: Envelope): boolean {
  if (env.type !== "session.jobs") return false;
  const reqId = env.payload.request_id;
  const deferred = target.pendingLists.get(reqId);
  if (deferred === undefined) return false;
  target.pendingLists.delete(reqId);
  deferred.resolve(env.payload);
  return true;
}

function handleJobSubscribed(target: DispatchTarget, env: Envelope): boolean {
  if (env.type !== "job.subscribed") return false;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.job_id === undefined) return false;
  const d = target.pendingSubscribes.get(env.job_id);
  if (d === undefined) return false;
  target.pendingSubscribes.delete(env.job_id);
  d.resolve(env.payload);
  return true;
}

async function invokeUserHandler(
  target: DispatchTarget,
  env: Envelope,
): Promise<void> {
  const handler = target.handlers.get(env.type);
  if (handler === undefined) {
    target.logger.debug(
      { type: env.type },
      "no client handler registered for type",
    );
    return;
  }
  try {
    await handler(env);
  } catch (error) {
    target.logger.error({ err: error, type: env.type }, "client handler threw");
  }
}

function routeJobEvent(target: DispatchTarget, env: Envelope): void {
  if (env.type === "job.accepted") {
    onJobAccepted(target, env);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.type === "job.event" && env.job_id !== undefined) {
    onJobEvent(target, env);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.type === "job.result" && env.job_id !== undefined) {
    onJobResult(target, env);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.type === "job.error" && env.job_id !== undefined) {
    onJobError(target, env);
  }
}

function onJobAccepted(
  target: DispatchTarget,
  env: Extract<Envelope, { type: "job.accepted" }>,
): void {
  const inv = target.pendingAccepts.shift();
  if (inv === undefined || inv.acceptance.settled) return;
  const payload = env.payload;
  inv.jobId = payload.job_id;
  inv.lease = payload.lease;
  inv.agent = payload.agent;
  inv.leaseConstraints = payload.lease_constraints;
  inv.budget = payload.budget;
  inv.traceId = payload.trace_id ?? inv.traceId;
  target.invocationsByJobId.set(payload.job_id, inv);
  inv.acceptance.resolve(payload);
}

function onJobEvent(
  target: DispatchTarget,
  env: Extract<Envelope, { type: "job.event" }>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.job_id === undefined) return;
  const inv = target.invocationsByJobId.get(env.job_id);
  if (inv === undefined) return;
  const ep = env.payload;
  inv.events.push(ep);
  // v1.1 §8.4 — accumulate result_chunk bodies for later assembly.
  if (ep.kind !== "result_chunk") return;
  const body = ep.body as ResultChunkBody;
  let bucket = inv.chunks.get(body.result_id);
  if (bucket === undefined) {
    bucket = [];
    inv.chunks.set(body.result_id, bucket);
  }
  bucket.push(body);
}

function onJobResult(
  target: DispatchTarget,
  env: Extract<Envelope, { type: "job.result" }>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.job_id === undefined) return;
  const inv = target.invocationsByJobId.get(env.job_id);
  if (inv === undefined) return;
  inv.completion.resolve(env.payload);
  target.invocationsByJobId.delete(env.job_id);
}

function onJobError(
  target: DispatchTarget,
  env: Extract<Envelope, { type: "job.error" }>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.job_id === undefined) return;
  const err = ARCPError.fromPayload(jobErrorToErrorPayload(env.payload));
  let inv = target.invocationsByJobId.get(env.job_id);
  if (inv === undefined) {
    // No binding yet — this can happen when the runtime rejects the submit
    // (AGENT_NOT_AVAILABLE, DUPLICATE_KEY, etc) without emitting job.accepted.
    inv = target.pendingAccepts.shift();
    if (inv !== undefined) {
      inv.jobId = env.job_id;
      target.invocationsByJobId.set(env.job_id, inv);
    }
  }
  if (inv === undefined) return;
  if (!inv.acceptance.settled) inv.acceptance.reject(err);
  inv.completion.reject(err);
  target.invocationsByJobId.delete(env.job_id);
}
