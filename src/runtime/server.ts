import { z } from "zod";
import type { BearerIdentity, BearerVerifier } from "../auth/bearer.js";
import type { JwtVerifier } from "../auth/jwt.js";
import { type BaseEnvelope, buildEnvelope, RoundTripEnvelopeSchema } from "../envelope.js";
import {
  ARCPError,
  FailedPreconditionError,
  InternalError,
  NotImplementedError,
  UnauthenticatedError,
} from "../errors.js";
import { type Logger, sessionLogger as makeSessionLogger, rootLogger } from "../logger.js";
import {
  type Capabilities,
  type ClientIdentity,
  type Envelope,
  EnvelopeSchema,
  isImplementedType,
  type RuntimeIdentity,
  type SessionAcceptedPayload,
  type SessionOpenPayloadSchema,
  type SessionRejectedPayload,
  type SessionUnauthenticatedPayload,
} from "../messages/index.js";
import { EventLog } from "../store/eventlog.js";
import type { Transport, WireFrame } from "../transport/base.js";
import { newMessageId, newSessionId, nowTimestamp } from "../util/ulid.js";
import { Job, JobManager, makeJobContext, type ToolHandler } from "./job.js";
import { negotiateCapabilities, SessionState } from "./session.js";

const HANDSHAKE_TYPES = new Set<string>([
  "session.open",
  "session.challenge",
  "session.authenticate",
  "session.accepted",
  "session.unauthenticated",
  "session.rejected",
]);

/** Inbound-message dispatcher signature. */
export type Handler = (env: Envelope, ctx: SessionContext) => Promise<void> | void;

/** Top-level server options. */
export interface ARCPServerOptions {
  /** Identity broadcast in `session.accepted` (§8.3). */
  runtime: RuntimeIdentity;
  /** Capabilities advertised by this runtime (§7). */
  capabilities: Capabilities;
  /** Bearer-token verifier for `auth.scheme: "bearer"`. Optional. */
  bearer?: BearerVerifier;
  /** JWT verifier for `auth.scheme: "signed_jwt"`. Optional. */
  jwt?: JwtVerifier;
  /** Whether to allow `auth.scheme: "none"` (gated on `capabilities.anonymous`). */
  allowAnonymous?: boolean;
  /** Event log to persist envelopes. Defaults to an in-memory log. */
  eventLog?: EventLog;
  /** Logger. Defaults to {@link rootLogger}. */
  logger?: Logger;
}

/**
 * Per-transport session context. Drives the handshake and dispatches inbound
 * envelopes through registered handlers.
 */
export class SessionContext {
  public readonly state = new SessionState();
  public readonly jobs = new JobManager();
  public readonly logger: Logger;
  private readonly handlers = new Map<string, Handler>();
  private closed = false;

  public constructor(
    public readonly transport: Transport,
    public readonly server: ARCPServer,
    logger: Logger,
  ) {
    this.logger = logger;
  }

  public registerHandler(type: string, handler: Handler): void {
    this.handlers.set(type, handler);
  }

  /** Send an envelope through the transport. */
  public async send(envelope: BaseEnvelope): Promise<void> {
    if (this.closed || this.transport.closed) {
      throw new FailedPreconditionError("Cannot send: session closed");
    }
    await this.transport.send(envelope as unknown as WireFrame);
    if (envelope.session_id !== undefined && envelope.session_id !== "") {
      try {
        await this.server.eventLog.append(envelope);
      } catch (err) {
        this.logger.error({ err }, "event log append (outbound) failed");
      }
    }
  }

  /** Send a nack with the given error code, correlated to a request id. */
  public async sendNack(toId: string, error: ARCPError): Promise<void> {
    const env = buildEnvelope({
      id: newMessageId(),
      type: "nack" as const,
      timestamp: nowTimestamp(),
      payload: { ...error.toPayload(), ack_for: toId },
      ...(this.state.id !== undefined ? { optional: { session_id: this.state.id } } : {}),
    });
    await this.transport.send(env as unknown as WireFrame);
  }

  /** Dispatch an inbound, raw frame. Errors are caught and reflected as `nack`. */
  public async dispatchRaw(frame: WireFrame): Promise<void> {
    let parsed: BaseEnvelope;
    try {
      parsed = RoundTripEnvelopeSchema.parse(frame) as BaseEnvelope;
    } catch (err) {
      this.logger.warn({ err }, "inbound envelope failed base-shape validation");
      return;
    }

    // Pre-handshake: drop non-handshake messages per §8.1.
    if (!this.state.isAccepted && !HANDSHAKE_TYPES.has(parsed.type)) {
      this.logger.warn(
        { type: parsed.type, id: parsed.id },
        "dropping pre-handshake non-handshake message (§8.1)",
      );
      return;
    }

    // Idempotent inbound: dedupe by (session_id, id) once a session exists.
    if (this.state.id !== undefined && parsed.session_id === this.state.id) {
      try {
        const inserted = await this.server.eventLog.append(parsed);
        if (!inserted) {
          this.logger.debug({ id: parsed.id }, "duplicate inbound, skipping dispatch");
          return;
        }
      } catch (err) {
        this.logger.error({ err }, "event log append (inbound) failed");
      }
    }

    // Validate against the discriminated union when known.
    let envelope: Envelope | undefined;
    const result = EnvelopeSchema.safeParse(parsed);
    if (result.success) {
      envelope = result.data;
    } else {
      // Unknown or malformed: nack with UNIMPLEMENTED for unknown types.
      const issue = result.error.issues[0];
      const looksUnknownType = issue?.code === z.ZodIssueCode.invalid_union_discriminator;
      const code = looksUnknownType ? "UNIMPLEMENTED" : "INVALID_ARGUMENT";
      const message = looksUnknownType
        ? `Unknown message type "${parsed.type}" (§21.3)`
        : `Invalid envelope: ${issue?.message ?? "schema validation failed"}`;
      await this.sendNack(parsed.id, new ARCPError({ code, message }));
      return;
    }

    if (!isImplementedType(envelope.type)) {
      await this.sendNack(
        envelope.id,
        new NotImplementedError(`Type "${envelope.type}" is not implemented in v0.1`),
      );
      return;
    }

    const handler = this.handlers.get(envelope.type);
    if (handler === undefined) {
      // Implemented in principle but not registered for this context: nack as UNIMPLEMENTED.
      await this.sendNack(
        envelope.id,
        new NotImplementedError(`No handler registered for "${envelope.type}"`),
      );
      return;
    }

    try {
      await handler(envelope, this);
    } catch (err) {
      this.logger.error({ err, type: envelope.type }, "handler threw");
      const wrapped =
        err instanceof ARCPError
          ? err
          : new InternalError(err instanceof Error ? err.message : String(err), {
              cause: err instanceof Error ? err : undefined,
            });
      await this.sendNack(envelope.id, wrapped);
    }
  }

  /** Tell the runtime this session is finished. Idempotent. */
  public async terminate(reason?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.close(reason);
  }
}

/**
 * Top-level ARCP runtime/server. Constructs per-transport
 * {@link SessionContext}s and drives the §8 handshake, then defers to
 * registered per-type handlers (added in later phases).
 */
export class ARCPServer {
  public readonly eventLog: EventLog;
  public readonly logger: Logger;
  private readonly tools = new Map<string, ToolHandler>();

  public constructor(public readonly options: ARCPServerOptions) {
    this.eventLog = options.eventLog ?? new EventLog();
    this.logger = options.logger ?? rootLogger;
  }

  /**
   * Register a tool handler. Tools are looked up by name on `tool.invoke`.
   * Re-registering the same name overwrites the previous handler.
   */
  public registerTool<Args = Record<string, unknown>, Result = unknown>(
    name: string,
    handler: ToolHandler<Args, Result>,
  ): void {
    this.tools.set(name, handler as ToolHandler);
  }

  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Adopt a {@link Transport} as a new session. Returns the
   * {@link SessionContext}; the handshake completes asynchronously.
   */
  public accept(transport: Transport): SessionContext {
    const ctx = new SessionContext(transport, this, this.logger);
    transport.onFrame((frame) => ctx.dispatchRaw(frame));
    transport.onClose(() => {
      const terminal: ReadonlySet<string> = new Set(["rejected", "evicted", "closing"]);
      if (terminal.has(ctx.state.phase)) return;
      ctx.state.transition(ctx.state.isAccepted ? "evicted" : "rejected");
    });
    this.registerHandshakeHandlers(ctx);
    return ctx;
  }

  /** Close the runtime and the underlying event log. */
  public async close(): Promise<void> {
    await this.eventLog.close();
  }

  // --- Handshake ---------------------------------------------------------

  private registerHandshakeHandlers(ctx: SessionContext): void {
    ctx.registerHandler("session.open", async (env) => {
      await this.handleSessionOpen(ctx, env);
    });
  }

  private async handleSessionOpen(ctx: SessionContext, env: Envelope): Promise<void> {
    if (env.type !== "session.open") return;
    if (ctx.state.phase !== "opening") {
      await ctx.sendNack(
        env.id,
        new FailedPreconditionError("session.open received in non-opening phase"),
      );
      return;
    }
    const payload = env.payload as z.infer<typeof SessionOpenPayloadSchema>;

    let identity: BearerIdentity;
    try {
      identity = await this.authenticateOpen(payload.auth);
    } catch (err) {
      const wrapped = err instanceof ARCPError ? err : new UnauthenticatedError("Auth failed");
      const sessionId = newSessionId();
      ctx.state.assignId(sessionId);
      ctx.logger.info({ scheme: payload.auth.scheme }, "rejecting session.open");
      await this.sendSessionRejected(ctx, env.id, wrapped);
      ctx.state.transition("rejected");
      return;
    }

    // Capability negotiation (§7).
    const negotiated = negotiateCapabilities(payload.capabilities, this.options.capabilities);
    if (
      payload.auth.scheme === "none" &&
      (payload.capabilities.anonymous !== true || this.options.capabilities.anonymous !== true)
    ) {
      await this.sendSessionRejected(
        ctx,
        env.id,
        new UnauthenticatedError("Anonymous auth not negotiated"),
      );
      ctx.state.transition("rejected");
      return;
    }

    const sessionId = newSessionId();
    ctx.state.assignId(sessionId);
    ctx.state.assignIdentity(identity);
    ctx.state.assignCapabilities(negotiated);

    const accepted: SessionAcceptedPayload = {
      session_id: sessionId,
      runtime: this.options.runtime,
      capabilities: negotiated,
    };
    const acceptEnv = buildEnvelope({
      id: newMessageId(),
      type: "session.accepted" as const,
      timestamp: nowTimestamp(),
      payload: accepted,
      optional: {
        session_id: sessionId,
        correlation_id: env.id,
      },
    });
    ctx.state.transition("accepted");
    await ctx.send(acceptEnv as BaseEnvelope);
    this.recordIdentity(ctx, payload.client);
    ctx.logger.info({ session_id: sessionId, principal: identity.principal }, "session accepted");
    this.registerPostHandshakeHandlers(ctx);
  }

  /** Register handlers that only become valid once the session is accepted. */
  private registerPostHandshakeHandlers(ctx: SessionContext): void {
    ctx.registerHandler("tool.invoke", async (env) => {
      if (env.type !== "tool.invoke") return;
      await this.handleToolInvoke(ctx, env);
    });
    ctx.registerHandler("cancel", async (env) => {
      if (env.type !== "cancel") return;
      await this.handleCancel(ctx, env);
    });
    ctx.registerHandler("interrupt", async (env) => {
      if (env.type !== "interrupt") return;
      await this.handleInterrupt(ctx, env);
    });
    ctx.registerHandler("ping", async (env) => {
      if (env.type !== "ping") return;
      const pong = buildEnvelope({
        id: newMessageId(),
        type: "pong" as const,
        timestamp: nowTimestamp(),
        payload: { ack_for: env.id, received_at: nowTimestamp() },
        optional: {
          session_id: ctx.state.id ?? "",
          correlation_id: env.id,
        },
      });
      await ctx.send(pong as BaseEnvelope);
    });
    ctx.registerHandler("session.close", async (env) => {
      if (env.type !== "session.close") return;
      const dispose = env.payload.dispose_jobs ?? "cancel";
      if (dispose === "cancel") ctx.jobs.cancelAll("session closed");
      ctx.state.transition("closing");
      await ctx.terminate(env.payload.reason);
    });
  }

  private async handleToolInvoke(ctx: SessionContext, env: Envelope): Promise<void> {
    if (env.type !== "tool.invoke") return;
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    const handler = this.tools.get(env.payload.tool);
    if (handler === undefined) {
      await ctx.sendNack(
        env.id,
        new NotImplementedError(`Tool "${env.payload.tool}" not registered`),
      );
      return;
    }
    const heartbeatSec = ctx.state.heartbeatInterval;
    const job = new Job(
      {
        originId: env.id,
        sessionId,
        heartbeatIntervalSeconds: heartbeatSec,
      },
      (out) => ctx.send(out),
      ctx.logger.child({ job_id: "<pending>" }),
    );
    ctx.jobs.register(job);
    Object.assign(job, { logger: ctx.logger.child({ job_id: job.jobId }) });
    await job.emitAccepted();
    await job.emitStarted();

    const args = env.payload.arguments ?? {};
    const jobCtx = makeJobContext(job);
    void this.runHandler(ctx, job, handler, args, jobCtx);
  }

  private async runHandler(
    ctx: SessionContext,
    job: Job,
    handler: ToolHandler,
    args: Record<string, unknown>,
    jobCtx: ReturnType<typeof makeJobContext>,
  ): Promise<void> {
    try {
      const value = await handler(args, jobCtx);
      if (!job.isTerminal) await job.emitToolResult(value);
    } catch (err) {
      if (job.isTerminal) {
        // Already cancelled or failed by the watchdog; nothing to do.
        return;
      }
      const wrapped =
        err instanceof ARCPError
          ? err
          : new InternalError(err instanceof Error ? err.message : String(err), {
              cause: err instanceof Error ? err : undefined,
            });
      await job.emitToolError(wrapped);
    } finally {
      ctx.jobs.retire(job.jobId);
    }
  }

  private async handleCancel(ctx: SessionContext, env: Envelope): Promise<void> {
    if (env.type !== "cancel") return;
    const { target, target_id, reason, deadline_ms } = env.payload;
    if (target !== "job") {
      await ctx.sendNack(
        env.id,
        new NotImplementedError(`cancel target "${target}" not supported in v0.1`),
      );
      return;
    }
    const job = ctx.jobs.get(target_id);
    if (job === undefined || job.isTerminal) {
      const refused = buildEnvelope({
        id: newMessageId(),
        type: "cancel.refused" as const,
        timestamp: nowTimestamp(),
        payload: {
          target,
          target_id,
          reason: job === undefined ? "not_found" : "already_terminal",
        },
        optional: { session_id: ctx.state.id ?? "", correlation_id: env.id },
      });
      await ctx.send(refused as BaseEnvelope);
      return;
    }
    const accepted = buildEnvelope({
      id: newMessageId(),
      type: "cancel.accepted" as const,
      timestamp: nowTimestamp(),
      payload: { target, target_id },
      optional: { session_id: ctx.state.id ?? "", correlation_id: env.id },
    });
    await ctx.send(accepted as BaseEnvelope);
    job.cancel(reason ?? "client_cancel", "client");
    if (deadline_ms !== undefined && deadline_ms > 0) {
      const timer = setTimeout(() => {
        if (!job.isTerminal) job.abortHard("cancellation deadline exceeded");
      }, deadline_ms);
      timer.unref();
    }
  }

  private async handleInterrupt(ctx: SessionContext, env: Envelope): Promise<void> {
    if (env.type !== "interrupt") return;
    const { target, target_id, prompt } = env.payload;
    if (target !== "job") return;
    const job = ctx.jobs.get(target_id);
    if (job === undefined || job.isTerminal) return;
    if (this.options.capabilities.interrupt === false) {
      await ctx.sendNack(env.id, new NotImplementedError("interrupt capability not advertised"));
      return;
    }
    job.block();
    const human = buildEnvelope({
      id: newMessageId(),
      type: "human.input.request" as const,
      timestamp: nowTimestamp(),
      payload: {
        prompt: prompt ?? "Job interrupted; awaiting human guidance.",
        response_schema: { type: "object" },
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
      optional: {
        session_id: ctx.state.id ?? "",
        job_id: job.jobId,
        causation_id: env.id,
      },
    });
    await ctx.send(human as BaseEnvelope);
  }

  private async authenticateOpen(
    auth: z.infer<typeof SessionOpenPayloadSchema>["auth"],
  ): Promise<BearerIdentity> {
    if (auth.scheme === "bearer") {
      const verifier = this.options.bearer;
      if (verifier === undefined) {
        throw new NotImplementedError("Runtime has no bearer verifier configured");
      }
      if (auth.token === undefined) {
        throw new UnauthenticatedError("bearer scheme requires `token`");
      }
      return verifier.verify(auth.token);
    }
    if (auth.scheme === "signed_jwt") {
      const verifier = this.options.jwt;
      if (verifier === undefined) {
        throw new NotImplementedError("Runtime has no JWT verifier configured");
      }
      if (auth.token === undefined) {
        throw new UnauthenticatedError("signed_jwt scheme requires `token`");
      }
      return verifier.verify(auth.token);
    }
    if (auth.scheme === "none") {
      if (this.options.allowAnonymous !== true) {
        throw new UnauthenticatedError("Anonymous auth disabled by runtime");
      }
      return { principal: "anonymous" };
    }
    throw new NotImplementedError(`Auth scheme "${auth.scheme}" not implemented in v0.1`);
  }

  private async sendSessionRejected(
    ctx: SessionContext,
    correlationId: string,
    err: ARCPError,
  ): Promise<void> {
    const payload: SessionRejectedPayload = err.toPayload();
    const env = buildEnvelope({
      id: newMessageId(),
      type: "session.rejected" as const,
      timestamp: nowTimestamp(),
      payload,
      optional: { correlation_id: correlationId },
    });
    await ctx.transport.send(env as unknown as WireFrame);
  }

  /** Bind the client identity into the session context's logger. */
  private recordIdentity(ctx: SessionContext, client: ClientIdentity): void {
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    Object.assign(ctx, {
      logger: makeSessionLogger(this.logger, sessionId).child({
        client_kind: client.kind,
        client_version: client.version,
      }),
    });
  }
}

/**
 * Helper schema for {@link SessionUnauthenticatedPayload} export consistency.
 * Re-exporting from messages/session.ts keeps the public surface tidy without
 * forcing every importer to walk to messages/.
 */
export type { SessionUnauthenticatedPayload };
