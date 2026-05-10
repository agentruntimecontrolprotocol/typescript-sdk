import { z } from "zod";
import { type BaseEnvelope, buildEnvelope, RoundTripEnvelopeSchema } from "../envelope.js";
import {
  ARCPError,
  CancelledError,
  FailedPreconditionError,
  UnauthenticatedError,
} from "../errors.js";
import { type Logger, rootLogger } from "../logger.js";
import {
  type AuthScheme,
  type CancelPayload,
  type Capabilities,
  type ClientIdentity,
  type Envelope,
  EnvelopeSchema,
  type HumanChoiceRequestPayload,
  type HumanChoiceResponsePayload,
  type HumanInputRequestPayload,
  type HumanInputResponsePayload,
  type JobProgressPayload,
  type LeaseRefreshPayload,
  type PermissionDenyPayload,
  type PermissionGrantPayload,
  type PermissionRequestPayload,
  type SessionAcceptedPayload,
  type StreamChunkPayload,
  type ToolResultPayload,
} from "../messages/index.js";
import { PendingRegistry } from "../runtime/pending.js";
import { SessionState } from "../runtime/session.js";
import { StreamReader } from "../runtime/stream.js";
import type { Transport, WireFrame } from "../transport/base.js";
import { Deferred } from "../util/deferred.js";
import { newMessageId, nowTimestamp } from "../util/ulid.js";
import type { HumanInputHandler, PermissionDecisionHandler } from "./handlers.js";

export interface ARCPClientOptions {
  /** Client identity broadcast in `session.open`. */
  client: ClientIdentity;
  /** Capabilities the client requests/supports. */
  capabilities: Capabilities;
  /** Auth scheme to use. */
  authScheme: AuthScheme;
  /** Token, where the scheme requires one. */
  token?: string;
  /** Logger. */
  logger?: Logger;
  /** Handshake timeout in milliseconds. Default 5000. */
  handshakeTimeoutMs?: number;
  /** Handler for `human.input.request` and `human.choice.request` (§12). */
  humanInputHandler?: HumanInputHandler;
  /** Handler for `permission.request` (§15.4). */
  permissionHandler?: PermissionDecisionHandler;
}

/** Inbound-message handler on the client side. */
export type ClientHandler = (env: Envelope) => Promise<void> | void;

/**
 * ARCP client. v0.1 covers the §8 handshake and provides hooks for sending
 * commands and receiving events. Phase 3+ adds typed `invoke()` and
 * `subscribe()` wrappers on top of this surface.
 */
/** Result of {@link ARCPClient.invoke}. */
export interface InvokeResult {
  /** The final tool.result payload. */
  readonly result: ToolResultPayload;
  /** Job id assigned by the runtime. */
  readonly jobId: string;
  /** Stream readers indexed by `stream_id`, populated as streams open. */
  readonly streams: ReadonlyMap<string, StreamReader>;
  /** Progress events received during execution, in order. */
  readonly progress: readonly JobProgressPayload[];
}

export class ARCPClient {
  public readonly state = new SessionState();
  public readonly pending = new PendingRegistry();
  public readonly logger: Logger;
  private readonly handlers = new Map<string, ClientHandler>();
  private transport: Transport | null = null;
  private handshake: Deferred<SessionAcceptedPayload> | null = null;
  private readonly handshakeTimeoutMs: number;
  // Maps `correlation_id (= origin tool.invoke id)` → in-flight invocation state.
  private readonly invocations = new Map<string, InvocationState>();
  // Maps `stream_id` → owning invocation correlation id.
  private readonly streamOwners = new Map<string, string>();

  public constructor(public readonly options: ARCPClientOptions) {
    this.logger = options.logger ?? rootLogger.child({ component: "arcp-client" });
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5000;
  }

  /**
   * Connect over `transport` and complete the §8 handshake.
   *
   * Resolves with the negotiated `session.accepted` payload; rejects with
   * an {@link ARCPError} on rejection, malformed envelopes, or timeout.
   */
  public async connect(transport: Transport): Promise<SessionAcceptedPayload> {
    if (this.transport !== null) {
      throw new FailedPreconditionError("ARCPClient is already connected");
    }
    this.transport = transport;
    this.handshake = new Deferred<SessionAcceptedPayload>();

    transport.onFrame((frame) => this.dispatchRaw(frame));
    transport.onClose((err) => {
      if (this.handshake !== null && !this.handshake.settled) {
        this.handshake.reject(
          new FailedPreconditionError("Transport closed before handshake completed", {
            cause: err,
          }),
        );
      }
    });

    const openId = newMessageId();
    const openEnv = buildEnvelope({
      id: openId,
      type: "session.open" as const,
      timestamp: nowTimestamp(),
      payload: {
        auth: {
          scheme: this.options.authScheme,
          ...(this.options.token !== undefined ? { token: this.options.token } : {}),
        },
        client: this.options.client,
        capabilities: this.options.capabilities,
      },
    });
    await transport.send(openEnv as unknown as WireFrame);

    const timeout = setTimeout(() => {
      if (this.handshake !== null && !this.handshake.settled) {
        this.handshake.reject(new FailedPreconditionError("Handshake timed out"));
      }
    }, this.handshakeTimeoutMs);
    timeout.unref();
    try {
      const accepted = await this.handshake.promise;
      this.state.assignId(accepted.session_id);
      this.state.assignCapabilities(accepted.capabilities);
      this.state.transition("accepted");
      return accepted;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Register a handler for a specific message type. */
  public on(type: string, handler: ClientHandler): void {
    this.handlers.set(type, handler);
  }

  /** Send an envelope to the runtime. Requires an accepted session. */
  public async send(env: BaseEnvelope): Promise<void> {
    if (this.transport === null) throw new FailedPreconditionError("Client not connected");
    if (!this.state.isAccepted) {
      throw new UnauthenticatedError("Cannot send: session not accepted");
    }
    await this.transport.send(env as unknown as WireFrame);
  }

  /** Close the underlying transport. */
  public async close(reason?: string): Promise<void> {
    this.pending.rejectAll(new CancelledError("Client closing"));
    for (const inv of this.invocations.values()) {
      inv.completion.reject(new CancelledError("Client closing"));
    }
    this.invocations.clear();
    this.streamOwners.clear();
    if (this.transport === null) return;
    await this.transport.close(reason);
    this.transport = null;
  }

  /**
   * Invoke a tool and await its `tool.result` (or reject on `tool.error`).
   *
   * Streams opened by the tool appear in {@link InvokeResult.streams}; the
   * caller can iterate them concurrently with awaiting the result.
   */
  public async invoke(
    tool: string,
    args: Record<string, unknown> = {},
    options: { idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<InvokeResult> {
    if (this.transport === null) throw new FailedPreconditionError("Client not connected");
    if (!this.state.isAccepted) {
      throw new UnauthenticatedError("Cannot invoke: session not accepted");
    }
    const sessionId = this.state.id;
    if (sessionId === undefined) throw new FailedPreconditionError("session has no id");
    const id = newMessageId();
    const env = buildEnvelope({
      id,
      type: "tool.invoke" as const,
      timestamp: nowTimestamp(),
      payload: { tool, arguments: args },
      optional: {
        session_id: sessionId,
        ...(options.idempotencyKey !== undefined
          ? { idempotency_key: options.idempotencyKey }
          : {}),
      },
    });

    const invocation: InvocationState = {
      originId: id,
      jobId: null,
      streams: new Map(),
      progress: [],
      completion: new Deferred<ToolResultPayload>(),
    };
    this.invocations.set(id, invocation);

    if (options.signal !== undefined) {
      const sig = options.signal;
      if (sig.aborted) {
        await this.cancelInvocation(invocation, sig.reason);
        throw new CancelledError("Aborted before sending tool.invoke");
      }
      sig.addEventListener(
        "abort",
        () => {
          void this.cancelInvocation(invocation, sig.reason);
        },
        { once: true },
      );
    }

    await this.transport.send(env as unknown as WireFrame);

    try {
      const result = await invocation.completion.promise;
      // Close any still-open streams gracefully when the result arrives.
      for (const reader of invocation.streams.values()) {
        if (!reader.streamId) continue;
        // No-op if already ended.
      }
      return {
        result,
        jobId: invocation.jobId ?? "",
        streams: invocation.streams,
        progress: invocation.progress,
      };
    } finally {
      this.invocations.delete(id);
      for (const sid of invocation.streams.keys()) {
        this.streamOwners.delete(sid);
      }
    }
  }

  /** Send a `cancel` envelope for the given target job. */
  public async cancelJob(
    jobId: string,
    options: { reason?: string; deadlineMs?: number } = {},
  ): Promise<void> {
    if (this.transport === null) throw new FailedPreconditionError("Client not connected");
    const sessionId = this.state.id;
    if (sessionId === undefined) throw new FailedPreconditionError("session has no id");
    const payload: CancelPayload = {
      target: "job",
      target_id: jobId,
      ...(options.reason !== undefined ? { reason: options.reason } : {}),
      ...(options.deadlineMs !== undefined ? { deadline_ms: options.deadlineMs } : {}),
    };
    const env = buildEnvelope({
      id: newMessageId(),
      type: "cancel" as const,
      timestamp: nowTimestamp(),
      payload,
      optional: { session_id: sessionId },
    });
    await this.transport.send(env as unknown as WireFrame);
  }

  /** Send an `interrupt` envelope for the given target job. */
  public async interruptJob(jobId: string, prompt?: string): Promise<void> {
    if (this.transport === null) throw new FailedPreconditionError("Client not connected");
    const sessionId = this.state.id;
    if (sessionId === undefined) throw new FailedPreconditionError("session has no id");
    const env = buildEnvelope({
      id: newMessageId(),
      type: "interrupt" as const,
      timestamp: nowTimestamp(),
      payload: {
        target: "job",
        target_id: jobId,
        ...(prompt !== undefined ? { prompt } : {}),
      },
      optional: { session_id: sessionId },
    });
    await this.transport.send(env as unknown as WireFrame);
  }

  private async cancelInvocation(inv: InvocationState, reason: unknown): Promise<void> {
    if (inv.jobId === null) return;
    try {
      await this.cancelJob(inv.jobId, {
        reason: reason instanceof Error ? reason.message : String(reason ?? "abort"),
      });
    } catch (err) {
      this.logger.warn({ err }, "failed to send cancel during abort");
    }
  }

  // -------------------------------------------------------------------

  private async dispatchRaw(frame: WireFrame): Promise<void> {
    let parsed: BaseEnvelope;
    try {
      parsed = RoundTripEnvelopeSchema.parse(frame) as BaseEnvelope;
    } catch (err) {
      this.logger.warn({ err }, "client received malformed frame");
      return;
    }

    // Handshake messages.
    if (parsed.type === "session.accepted") {
      const result = EnvelopeSchema.safeParse(parsed);
      if (result.success && result.data.type === "session.accepted") {
        this.handshake?.resolve(result.data.payload);
      }
      return;
    }
    if (parsed.type === "session.rejected") {
      const result = EnvelopeSchema.safeParse(parsed);
      if (result.success && result.data.type === "session.rejected") {
        this.handshake?.reject(ARCPError.fromPayload(result.data.payload));
      }
      return;
    }

    // For everything else: validate and dispatch to a registered handler.
    const result = EnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      this.logger.warn(
        { type: parsed.type, code: issue?.code, message: issue?.message },
        "client received unparseable envelope",
      );
      // No nack from the client — observers and active clients alike should
      // tolerate unknown messages without disrupting the session.
      return;
    }
    const env = result.data;
    this.routeJobOrStreamEvent(env);
    void this.handleAutoResponse(env);
    const handler = this.handlers.get(env.type);
    if (handler !== undefined) {
      try {
        await handler(env);
      } catch (err) {
        this.logger.error({ err, type: env.type }, "client handler threw");
      }
      return;
    }
    this.logger.debug({ type: env.type }, "no client handler registered for type");
  }

  /**
   * Route inbound job/tool/stream events into the in-flight invocation map
   * so {@link invoke} can resolve. This is independent of any user-registered
   * handlers — both can run.
   */
  private routeJobOrStreamEvent(env: Envelope): void {
    if (env.type === "nack") {
      const ackFor = env.payload.ack_for;
      if (ackFor !== undefined && this.invocations.has(ackFor)) {
        const inv = this.invocations.get(ackFor);
        if (inv !== undefined) {
          inv.completion.reject(ARCPError.fromPayload(env.payload));
        }
      }
      return;
    }
    if (env.type === "job.accepted" && env.correlation_id !== undefined) {
      const inv = this.invocations.get(env.correlation_id);
      if (inv !== undefined) inv.jobId = env.payload.job_id;
      return;
    }
    if (env.type === "job.progress" && env.job_id !== undefined) {
      const inv = this.findInvocationByJobId(env.job_id);
      if (inv !== undefined) inv.progress.push(env.payload);
      return;
    }
    if (env.type === "tool.result" && env.correlation_id !== undefined) {
      const inv = this.invocations.get(env.correlation_id);
      if (inv !== undefined) {
        for (const reader of inv.streams.values()) reader.end();
        inv.completion.resolve(env.payload);
      }
      return;
    }
    if (env.type === "tool.error" && env.correlation_id !== undefined) {
      const inv = this.invocations.get(env.correlation_id);
      if (inv !== undefined) {
        for (const reader of inv.streams.values()) reader.fail(ARCPError.fromPayload(env.payload));
        inv.completion.reject(ARCPError.fromPayload(env.payload));
      }
      return;
    }
    if (env.type === "job.failed" && env.job_id !== undefined) {
      const inv = this.findInvocationByJobId(env.job_id);
      if (inv !== undefined) {
        const err = ARCPError.fromPayload(env.payload);
        for (const reader of inv.streams.values()) reader.fail(err);
        inv.completion.reject(err);
      }
      return;
    }
    if (env.type === "job.cancelled" && env.job_id !== undefined) {
      const inv = this.findInvocationByJobId(env.job_id);
      if (inv !== undefined) {
        const err = new CancelledError(env.payload.reason ?? "cancelled");
        for (const reader of inv.streams.values()) reader.fail(err);
        inv.completion.reject(err);
      }
      return;
    }
    if (env.type === "stream.open" && env.stream_id !== undefined) {
      // Associate stream with the most recent in-flight invocation owning the
      // related_job_id, if any. Otherwise leave unowned.
      const relatedJob = env.payload.related_job_id;
      if (relatedJob !== undefined) {
        const inv = this.findInvocationByJobId(relatedJob);
        if (inv !== undefined) {
          const reader = new StreamReader(env.stream_id);
          inv.streams.set(env.stream_id, reader);
          this.streamOwners.set(env.stream_id, inv.originId);
        }
      }
      return;
    }
    if (env.type === "stream.chunk" && env.stream_id !== undefined) {
      const ownerId = this.streamOwners.get(env.stream_id);
      if (ownerId === undefined) return;
      const inv = this.invocations.get(ownerId);
      const reader = inv?.streams.get(env.stream_id);
      reader?.push(env.payload as StreamChunkPayload);
      return;
    }
    if (env.type === "stream.close" && env.stream_id !== undefined) {
      const ownerId = this.streamOwners.get(env.stream_id);
      if (ownerId === undefined) return;
      const inv = this.invocations.get(ownerId);
      inv?.streams.get(env.stream_id)?.end();
      return;
    }
    if (env.type === "stream.error" && env.stream_id !== undefined) {
      const ownerId = this.streamOwners.get(env.stream_id);
      if (ownerId === undefined) return;
      const inv = this.invocations.get(ownerId);
      inv?.streams.get(env.stream_id)?.fail(ARCPError.fromPayload(env.payload));
      return;
    }
  }

  private findInvocationByJobId(jobId: string): InvocationState | undefined {
    for (const inv of this.invocations.values()) {
      if (inv.jobId === jobId) return inv;
    }
    return undefined;
  }

  /**
   * Auto-respond to inbound HITL and permission requests by dispatching to
   * the registered handlers. Errors from the handler reflect as `nack`.
   */
  private async handleAutoResponse(env: Envelope): Promise<void> {
    if (this.transport === null) return;
    const sessionId = this.state.id;
    if (sessionId === undefined) return;

    if (env.type === "human.input.request") {
      const handler = this.options.humanInputHandler;
      if (handler === undefined) {
        this.logger.warn(
          { id: env.id },
          "human.input.request received but no humanInputHandler registered",
        );
        return;
      }
      try {
        const response: HumanInputResponsePayload = await handler.onInputRequest(env.payload);
        await this.send(
          buildEnvelope({
            id: newMessageId(),
            type: "human.input.response" as const,
            timestamp: nowTimestamp(),
            payload: response,
            optional: { session_id: sessionId, correlation_id: env.id },
          }) as BaseEnvelope,
        );
      } catch (err) {
        this.logger.error({ err }, "human input handler threw");
      }
      return;
    }

    if (env.type === "human.choice.request") {
      const handler = this.options.humanInputHandler;
      if (handler === undefined) {
        this.logger.warn(
          { id: env.id },
          "human.choice.request received but no humanInputHandler registered",
        );
        return;
      }
      try {
        const response: HumanChoiceResponsePayload = await handler.onChoiceRequest(env.payload);
        await this.send(
          buildEnvelope({
            id: newMessageId(),
            type: "human.choice.response" as const,
            timestamp: nowTimestamp(),
            payload: response,
            optional: { session_id: sessionId, correlation_id: env.id },
          }) as BaseEnvelope,
        );
      } catch (err) {
        this.logger.error({ err }, "human choice handler threw");
      }
      return;
    }

    if (env.type === "permission.request") {
      const handler = this.options.permissionHandler;
      if (handler === undefined) {
        this.logger.warn(
          { id: env.id },
          "permission.request received but no permissionHandler registered",
        );
        return;
      }
      try {
        const decision = await handler.decide(env.payload);
        if (decision.kind === "grant") {
          await this.send(
            buildEnvelope({
              id: newMessageId(),
              type: "permission.grant" as const,
              timestamp: nowTimestamp(),
              payload: decision.grant,
              optional: { session_id: sessionId, correlation_id: env.id },
            }) as BaseEnvelope,
          );
        } else {
          await this.send(
            buildEnvelope({
              id: newMessageId(),
              type: "permission.deny" as const,
              timestamp: nowTimestamp(),
              payload: decision.deny,
              optional: { session_id: sessionId, correlation_id: env.id },
            }) as BaseEnvelope,
          );
        }
      } catch (err) {
        this.logger.error({ err }, "permission handler threw");
      }
      return;
    }
  }

  /**
   * Send a `lease.refresh` request and return the new expiry on success.
   * Resolves with the `lease.extended` payload; rejects on `nack`.
   */
  public async refreshLease(payload: LeaseRefreshPayload): Promise<{ expires_at: string }> {
    if (this.transport === null) throw new FailedPreconditionError("Client not connected");
    const sessionId = this.state.id;
    if (sessionId === undefined) throw new FailedPreconditionError("session has no id");
    const env = buildEnvelope({
      id: newMessageId(),
      type: "lease.refresh" as const,
      timestamp: nowTimestamp(),
      payload,
      optional: { session_id: sessionId },
    });
    await this.transport.send(env as unknown as WireFrame);
    // For v0.1 the runtime emits `lease.extended` (no correlation_id) on success
    // and `nack` on failure. The caller is expected to listen to those events.
    return new Promise<{ expires_at: string }>((resolve, reject) => {
      const onExtended = (e: Envelope): void => {
        if (e.type === "lease.extended" && e.payload.lease_id === payload.lease_id) {
          this.handlers.delete("lease.extended");
          resolve({ expires_at: e.payload.expires_at });
        }
      };
      const onNack = (e: Envelope): void => {
        if (e.type === "nack" && e.payload.ack_for === env.id) {
          this.handlers.delete("nack");
          reject(ARCPError.fromPayload(e.payload));
        }
      };
      this.handlers.set("lease.extended", onExtended);
      this.handlers.set("nack", onNack);
    });
  }
}

// PermissionGrantPayload, PermissionRequestPayload, etc. are surfaced through
// the public `arcp` import; re-export here for tooling that imports from
// the client subpath directly.
export type {
  HumanChoiceRequestPayload,
  HumanChoiceResponsePayload,
  HumanInputRequestPayload,
  HumanInputResponsePayload,
  LeaseRefreshPayload,
  PermissionDenyPayload,
  PermissionGrantPayload,
  PermissionRequestPayload,
};

interface InvocationState {
  readonly originId: string;
  jobId: string | null;
  readonly streams: Map<string, StreamReader>;
  readonly progress: JobProgressPayload[];
  readonly completion: Deferred<ToolResultPayload>;
}

/**
 * Lightweight typed assertion used in tests and bridge code: narrow an
 * envelope to a specific type. Returns null if the type does not match.
 */
export function asEnvelopeOfType<T extends Envelope["type"]>(
  env: Envelope,
  type: T,
): Extract<Envelope, { type: T }> | null {
  return env.type === type ? (env as Extract<Envelope, { type: T }>) : null;
}

// Schema re-imports kept to avoid circular dependencies during module load.
export const _envelopeSchema = z.lazy(() => EnvelopeSchema);
