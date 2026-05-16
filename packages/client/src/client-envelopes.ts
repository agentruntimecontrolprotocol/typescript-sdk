import type { JobId, MessageId, SessionId } from "@arcp/core";
import { type BaseEnvelope, buildEnvelope } from "@arcp/core/envelope";
import type { Capabilities, SessionResume } from "@arcp/core/messages";
import { newMessageId } from "@arcp/core/util";

import type { ARCPClientOptions, SubmitOptions } from "./types.js";

export interface HelloInput {
  id: MessageId;
  options: ARCPClientOptions;
  capabilities: Capabilities;
  resume: SessionResume | undefined;
}

export function buildHelloEnvelope(input: HelloInput): BaseEnvelope {
  return buildEnvelope({
    id: input.id,
    type: "session.hello" as const,
    payload: {
      client: input.options.client,
      auth: {
        scheme: input.options.authScheme,
        ...(input.options.token === undefined
          ? {}
          : { token: input.options.token }),
      },
      capabilities: input.capabilities,
      ...(input.resume === undefined ? {} : { resume: input.resume }),
    },
  });
}

export interface SubmitEnvelopeInput {
  id: MessageId;
  sessionId: SessionId;
  opts: SubmitOptions;
}

export function buildSubmitEnvelope(input: SubmitEnvelopeInput): BaseEnvelope {
  const { id, sessionId, opts } = input;
  return buildEnvelope({
    id,
    type: "job.submit" as const,
    payload: {
      agent: opts.agent,
      input: opts.input,
      ...(opts.lease === undefined ? {} : { lease_request: opts.lease }),
      ...(opts.leaseConstraints === undefined
        ? {}
        : { lease_constraints: opts.leaseConstraints }),
      ...(opts.idempotencyKey === undefined
        ? {}
        : { idempotency_key: opts.idempotencyKey }),
      ...(opts.maxRuntimeSec === undefined
        ? {}
        : { max_runtime_sec: opts.maxRuntimeSec }),
    },
    optional: {
      session_id: sessionId,
      ...(opts.traceId === undefined ? {} : { trace_id: opts.traceId }),
    },
  });
}

export function buildSubscribeEnvelope(
  jobId: JobId,
  sessionId: SessionId,
  opts: { history?: boolean; fromEventSeq?: number },
): BaseEnvelope {
  return buildEnvelope({
    id: newMessageId(),
    type: "job.subscribe" as const,
    payload: {
      job_id: jobId,
      ...(opts.history === undefined ? {} : { history: opts.history }),
      ...(opts.fromEventSeq === undefined
        ? {}
        : { from_event_seq: opts.fromEventSeq }),
    },
    optional: { session_id: sessionId },
  });
}

export function buildUnsubscribeEnvelope(
  jobId: JobId,
  sessionId: SessionId,
): BaseEnvelope {
  return buildEnvelope({
    id: newMessageId(),
    type: "job.unsubscribe" as const,
    payload: { job_id: jobId },
    optional: { session_id: sessionId },
  });
}

export function buildByeEnvelope(
  sessionId: SessionId,
  reason: string | undefined,
): BaseEnvelope {
  return buildEnvelope({
    id: newMessageId(),
    type: "session.bye" as const,
    payload: reason === undefined ? {} : { reason },
    optional: { session_id: sessionId },
  });
}
