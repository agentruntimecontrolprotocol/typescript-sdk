import type { JobId } from "@arcp/core";
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
  JobAcceptedPayloadSchema,
  type JobAcceptedPayload,
  jobErrorToErrorPayload,
  JobErrorPayloadSchema,
  type JobErrorPayload,
  JobEventPayloadSchema,
  type JobEventPayload,
  JobResultPayloadSchema,
  type JobResultPayload,
  JobSubscribedPayloadSchema,
  type JobSubscribedPayload,
  parseJobEventBody,
  type ResultChunkBody,
  SessionJobsPayloadSchema,
  type SessionJobsPayload,
  SessionPingPayloadSchema,
  SessionWelcomePayloadSchema,
  type SessionWelcomePayload,
  SessionErrorPayloadSchema,
} from "@arcp/core/messages";
import type { SessionState } from "@arcp/core/state";
import type { Transport, WireFrame } from "@arcp/core/transport";
import { type Deferred, newMessageId } from "@arcp/core/util";
import { type Schema as EffectSchema, Schema } from "effect";

import type { InvocationState } from "./client-handle.js";

/** Decode a wire payload against an Effect schema; returns null on failure. */
function decodePayload<S extends EffectSchema.Schema.AnyNoContext>(
  schema: S,
  payload: unknown,
): EffectSchema.Schema.Type<S> | null {
  try {
    return Schema.decodeUnknownSync(schema)(
      payload,
    ) as EffectSchema.Schema.Type<S>;
  } catch {
    return null;
  }
}

function decodeJobSubscribedPayload(
  payload: unknown,
): JobSubscribedPayload | null {
  try {
    const decoded: JobSubscribedPayload = Schema.decodeUnknownSync(
      JobSubscribedPayloadSchema as EffectSchema.Schema<
        JobSubscribedPayload,
        unknown
      >,
    )(payload);
    return decoded;
  } catch {
    return null;
  }
}

function decodeJobAcceptedPayload(
  payload: unknown,
): JobAcceptedPayload | null {
  try {
    const decoded: JobAcceptedPayload = Schema.decodeUnknownSync(
      JobAcceptedPayloadSchema as EffectSchema.Schema<
        JobAcceptedPayload,
        unknown
      >,
    )(payload);
    return decoded;
  } catch {
    return null;
  }
}

function decodeJobEventPayload(payload: unknown): JobEventPayload | null {
  try {
    return Schema.decodeUnknownSync(
      JobEventPayloadSchema as EffectSchema.Schema<JobEventPayload, unknown>,
    )(payload);
  } catch {
    return null;
  }
}

/** Mutable bits a dispatch routine needs to read/write. */
export interface DispatchTarget {
  readonly logger: Logger;
  readonly state: SessionState;
  readonly handshake: Deferred<SessionWelcomePayload> | null;
  readonly invocationsByOriginId: Map<string, InvocationState>;
  readonly invocationsByJobId: Map<string, InvocationState>;
  readonly pendingAccepts: InvocationState[];
  readonly pendingLists: Map<string, Deferred<SessionJobsPayload>>;
  readonly pendingSubscribes: Map<string, Deferred<JobSubscribedPayload>>;
  readonly handlers: Map<string, (env: Envelope) => Promise<void>>;
  readonly transport: Transport | null;
  observeEventSeq(env: BaseEnvelope): void;
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
  target.observeEventSeq(parsed);
  if (handleSessionJobs(target, parsed)) return;
  if (handleJobSubscribed(target, parsed)) return;
  routeJobEvent(target, parsed);
  await invokeUserHandler(target, env);
}

function safeParseRoundTrip(
  target: DispatchTarget,
  frame: WireFrame,
): BaseEnvelope | null {
  try {
    return Schema.decodeUnknownSync(RoundTripEnvelopeSchema)(frame);
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
  const payload = decodePayload(SessionWelcomePayloadSchema, parsed.payload);
  if (payload === null) return;
  if (parsed.session_id !== undefined && parsed.session_id !== "") {
    try {
      target.state.assignId(parsed.session_id);
    } catch {
      // ignore — likely a resume on the same id
    }
  }
  target.handshake?.resolve(payload);
}

function onSessionError(target: DispatchTarget, parsed: BaseEnvelope): void {
  const payload = decodePayload(SessionErrorPayloadSchema, parsed.payload);
  if (payload === null) return;
  const err = ARCPError.fromPayload(payload);
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
  const ping = decodePayload(SessionPingPayloadSchema, parsed.payload);
  if (ping === null) return;
  const sessionId = target.state.id;
  if (sessionId === undefined || target.transport === null) return;
  const pongEnv = buildEnvelope({
    id: newMessageId(),
    type: "session.pong" as const,
    payload: {
      ping_nonce: ping.nonce,
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
  try {
    return Schema.decodeUnknownSync(
      EnvelopeSchema as EffectSchema.Schema<Envelope, unknown>,
    )(parsed);
  } catch (error) {
    target.logger.warn(
      { type: parsed.type, err: error },
      "client received unparseable envelope",
    );
    return null;
  }
}

function handleSessionJobs(target: DispatchTarget, env: BaseEnvelope): boolean {
  if (env.type !== "session.jobs") return false;
  const payload = decodePayload(SessionJobsPayloadSchema, env.payload);
  if (payload === null) return false;
  const deferred = target.pendingLists.get(payload.request_id);
  if (deferred === undefined) return false;
  target.pendingLists.delete(payload.request_id);
  deferred.resolve(payload);
  return true;
}

function handleJobSubscribed(
  target: DispatchTarget,
  env: BaseEnvelope,
): boolean {
  if (env.type !== "job.subscribed") return false;
  const payload = decodeJobSubscribedPayload(env.payload);
  if (payload === null) return false;
  const d = target.pendingSubscribes.get(payload.job_id);
  if (d === undefined) return false;
  target.pendingSubscribes.delete(payload.job_id);
  d.resolve(payload);
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

function routeJobEvent(target: DispatchTarget, parsed: BaseEnvelope): void {
  if (parsed.type === "job.accepted") {
    routeJobAccepted(target, parsed);
    return;
  }
  if (parsed.type === "job.event") {
    routeJobEventFrame(target, parsed);
    return;
  }
  if (parsed.type === "job.result") {
    routeJobResultFrame(target, parsed);
    return;
  }
  if (parsed.type === "job.error") {
    routeJobErrorFrame(target, parsed);
  }
}

function routeJobAccepted(target: DispatchTarget, parsed: BaseEnvelope): void {
  const payload = decodeJobAcceptedPayload(parsed.payload);
  if (payload !== null) onJobAccepted(target, payload);
}

function routeJobEventFrame(
  target: DispatchTarget,
  parsed: BaseEnvelope,
): void {
  if (parsed.job_id === undefined) return;
  const payload = decodeJobEventPayload(parsed.payload);
  if (payload !== null) onJobEvent(target, parsed.job_id, payload);
}

function routeJobResultFrame(
  target: DispatchTarget,
  parsed: BaseEnvelope,
): void {
  if (parsed.job_id === undefined) return;
  const payload = decodePayload(JobResultPayloadSchema, parsed.payload);
  if (payload !== null) onJobResult(target, parsed.job_id, payload);
}

function routeJobErrorFrame(
  target: DispatchTarget,
  parsed: BaseEnvelope,
): void {
  if (parsed.job_id === undefined) return;
  const payload = decodePayload(JobErrorPayloadSchema, parsed.payload);
  if (payload !== null) onJobError(target, parsed.job_id, payload);
}

function onJobAccepted(
  target: DispatchTarget,
  payload: JobAcceptedPayload,
): void {
  const inv = target.pendingAccepts.shift();
  if (inv === undefined || inv.acceptance.settled) return;
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
  jobId: JobId,
  ep: JobEventPayload,
): void {
  const inv = target.invocationsByJobId.get(jobId);
  if (inv === undefined) return;
  inv.events.push(ep);
  if (ep.kind !== "result_chunk") return;
  let body: ResultChunkBody;
  try {
    body = parseJobEventBody("result_chunk", ep.body);
  } catch {
    return;
  }
  let bucket = inv.chunks.get(body.result_id);
  if (bucket === undefined) {
    bucket = [];
    inv.chunks.set(body.result_id, bucket);
  }
  bucket.push(body);
}

function onJobResult(
  target: DispatchTarget,
  jobId: JobId,
  payload: JobResultPayload,
): void {
  const inv = target.invocationsByJobId.get(jobId);
  if (inv === undefined) return;
  inv.completion.resolve(payload);
  target.invocationsByJobId.delete(jobId);
}

function onJobError(
  target: DispatchTarget,
  jobId: JobId,
  payload: JobErrorPayload,
): void {
  const err = ARCPError.fromPayload(jobErrorToErrorPayload(payload));
  let inv = target.invocationsByJobId.get(jobId);
  if (inv === undefined) {
    // No binding yet — this can happen when the runtime rejects the submit
    // (AGENT_NOT_AVAILABLE, DUPLICATE_KEY, etc) without emitting job.accepted.
    inv = target.pendingAccepts.shift();
    if (inv !== undefined) {
      inv.jobId = jobId;
      target.invocationsByJobId.set(jobId, inv);
    }
  }
  if (inv === undefined) return;
  if (!inv.acceptance.settled) inv.acceptance.reject(err);
  inv.completion.reject(err);
  target.invocationsByJobId.delete(jobId);
}
