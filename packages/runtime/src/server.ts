import { randomBytes } from "node:crypto";

import type { EventSeq, JobId, SessionId } from "@arcp/core";
import type { BearerIdentity } from "@arcp/core/auth";
import {
  type BaseEnvelope,
  buildEnvelope,
  RoundTripEnvelopeSchema,
} from "@arcp/core/envelope";
import {
  ARCPError,
  HeartbeatLostError,
  InternalError,
  InvalidRequestError,
  PermissionDeniedError,
  ResumeWindowExpiredError,
  UnauthenticatedError,
} from "@arcp/core/errors";
import { classifyUnknownType } from "@arcp/core/extensions";
import {
  type Logger,
  sessionLogger as makeSessionLogger,
  rootLogger,
} from "@arcp/core/logger";
import {
  type AgentInventoryEntry,
  type Capabilities,
  type Envelope,
  EnvelopeSchema,
  type JobErrorPayload,
  type JobListEntry,
  type SessionHelloPayload,
  type SessionListJobsFilter,
  type SessionWelcomePayload,
} from "@arcp/core/messages";
import {
  negotiateCapabilities,
  PendingRegistry,
  SessionState,
} from "@arcp/core/state";
import { EventLog } from "@arcp/core/store";
import type { Transport, WireFrame } from "@arcp/core/transport";
import { newMessageId, newSessionId } from "@arcp/core/util";
import { intersectFeatures, V1_1_FEATURES } from "@arcp/core/version";
import { z } from "zod";

import { AgentRegistry } from "./agent-registry.js";
import { forwardEventToSubscriber, JobRunner } from "./job-runner.js";
import type { Job } from "./job.js";
import { JobManager } from "./job.js";
import {
  compareJobListEntries,
  compileListJobsFilter,
  type ListJobsFilter,
  paginateJobList,
} from "./list-jobs.js";
import { IdempotencyStore, newResumeToken, ResumeStore } from "./stores.js";
import type {
  AgentHandler,
  ARCPServerOptions,
  EventSeqSource,
  Handler,
} from "./types.js";

// ARCP v1.1 (additive over v1.0) runtime.
//
// v1.0 dispatch: session.hello → session.welcome | session.error.
// Post-welcome: job.submit, job.cancel, session.bye. Outbound: job.accepted,
// job.event, job.result, job.error, session.welcome, session.bye, session.error.
//
// v1.1 adds: session.ping, session.pong, session.ack, session.list_jobs,
// session.jobs, job.subscribe, job.subscribed, job.unsubscribe. Plus the
// `progress`/`result_chunk` event kinds, `lease_constraints` (expires_at),
// `cost.budget`, and agent versioning.

const HANDSHAKE_TYPES = new Set<string>(["session.hello"]);
// session.ping/pong/ack are session-control envelopes (not event-seq-bearing),
// so they bypass the inbound dedupe-and-log step.
const INBOUND_DEDUPE_SKIP: ReadonlySet<string> = new Set([
  "session.ping",
  "session.pong",
  "session.ack",
]);

const DEFAULT_HEARTBEAT_SECONDS = 30;
const DEFAULT_RESUME_WINDOW_SECONDS = 600;
const DEFAULT_GRACE_MS = 30_000;
const DEFAULT_MAX_BUFFERED_EVENTS = 10_000;
const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024; // 16 MiB
const DEFAULT_BACK_PRESSURE_THRESHOLD = 1000;

function defaultJobAuthorizationPolicy(
  job: Job,
  principal: string | undefined,
): boolean {
  return job.submitterPrincipal === principal;
}

function isReplayableForJob(env: BaseEnvelope, jobId: JobId): boolean {
  if (env.job_id !== jobId) return false;
  return (
    env.type === "job.event" ||
    env.type === "job.result" ||
    env.type === "job.error"
  );
}

function buildSubscribedPayload(
  job: Job,
  subscribedFrom: number,
  replayed: boolean,
): Record<string, unknown> {
  return {
    job_id: job.jobId,
    current_status: job.state,
    agent: job.agentRef,
    lease: job.lease,
    ...(job.leaseConstraints === undefined
      ? {}
      : { lease_constraints: job.leaseConstraints }),
    parent_job_id: job.parentJobId ?? null,
    ...(job.traceId === undefined ? {} : { trace_id: job.traceId }),
    subscribed_from: subscribedFrom,
    replayed,
  };
}

/**
 * Per-transport session context. Drives the handshake and dispatches
 * inbound envelopes.
 */
export class SessionContext implements EventSeqSource {
  public readonly state = new SessionState();
  public readonly jobs = new JobManager();
  public readonly pending = new PendingRegistry();
  public logger: Logger;
  private readonly handlers = new Map<string, Handler>();
  private closed = false;
  private eventSeq = 0;
  private bufferedEventCount = 0;
  private bufferedBytes = 0;
  private lastMessageAt: number = Date.now();
  private lastInboundAt: number = Date.now();
  /** Active idempotent keys for jobs that resolved through this session. */
  private readonly localKeys = new Set<string>();
  /** v1.1 §6.2 — negotiated feature set. */
  private _negotiatedFeatures: readonly string[] = [];
  /** v1.1 §6.4 — periodic ping timer. */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** v1.1 §6.4 — pending ping nonce awaiting pong. */
  private outstandingPingNonce: string | null = null;
  /** v1.1 §6.5 — highest seq the client has acknowledged. */
  private lastAckedSeq = 0;
  private backPressureNotified = false;
  /**
   * v1.1 §7.6 — jobs we are observing as a subscriber (not the submitter).
   * Maps job_id → unsubscribe callback.
   */
  public readonly subscriptions = new Map<string, () => void>();

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

  /** Per-session monotonic event sequence (§8.3). */
  public nextEventSeq(): EventSeq {
    this.eventSeq += 1;
    return this.eventSeq as EventSeq;
  }

  public get latestEventSeq(): EventSeq {
    return this.eventSeq as EventSeq;
  }

  public setEventSeq(value: number): void {
    this.eventSeq = value;
  }

  public touch(): void {
    this.lastMessageAt = Date.now();
  }

  public get lastActivityAt(): number {
    return this.lastMessageAt;
  }

  public get lastInboundActivityAt(): number {
    return this.lastInboundAt;
  }

  public addLocalIdempotencyKey(key: string): void {
    this.localKeys.add(key);
  }

  public hasLocalIdempotencyKey(key: string): boolean {
    return this.localKeys.has(key);
  }

  public get negotiatedFeatures(): readonly string[] {
    return this._negotiatedFeatures;
  }

  public hasFeature(name: string): boolean {
    return this._negotiatedFeatures.includes(name);
  }

  public assignNegotiatedFeatures(features: readonly string[]): void {
    this._negotiatedFeatures = features;
  }

  public get lastAckedEventSeq(): number {
    return this.lastAckedSeq;
  }

  public recordAck(seq: number): void {
    if (seq > this.lastAckedSeq) this.lastAckedSeq = seq;
  }

  /** Send an envelope through the transport. */
  public async send(envelope: BaseEnvelope): Promise<void> {
    if (this.closed || this.transport.closed) {
      throw new InvalidRequestError("Cannot send: session closed");
    }
    this.touch();
    await this.transport.send(envelope);
    await this.persistOutbound(envelope);
    await this.fanOutToSubscribers(envelope);
    this.maybeEmitBackPressure();
  }

  private async persistOutbound(envelope: BaseEnvelope): Promise<void> {
    if (envelope.session_id === undefined || envelope.session_id === "") return;
    try {
      await this.server.eventLog.append(envelope);
      // Account against per-session caps for replay buffer estimation.
      this.bufferedEventCount += 1;
      this.bufferedBytes += JSON.stringify(envelope).length;
      this.checkCaps();
    } catch (error) {
      this.logger.error({ err: error }, "event log append (outbound) failed");
    }
  }

  private async fanOutToSubscribers(envelope: BaseEnvelope): Promise<void> {
    if (envelope.job_id === undefined) return;
    if (
      envelope.type !== "job.event" &&
      envelope.type !== "job.result" &&
      envelope.type !== "job.error"
    ) {
      return;
    }
    const subs = this.server.subscribers.get(envelope.job_id);
    if (subs === undefined || subs.size === 0) return;
    for (const sub of subs) {
      if (sub === this || sub.state.id === undefined) continue;
      await this.forwardEnvelopeToSubscriber(sub, envelope);
    }
  }

  private async forwardEnvelopeToSubscriber(
    sub: SessionContext,
    envelope: BaseEnvelope,
  ): Promise<void> {
    if (sub.state.id === undefined) return;
    try {
      const forwarded = buildEnvelope({
        id: newMessageId(),
        type: envelope.type,
        payload: envelope.payload,
        optional: {
          session_id: sub.state.id,
          job_id: envelope.job_id,
          ...(envelope.trace_id === undefined
            ? {}
            : { trace_id: envelope.trace_id }),
          ...(envelope.event_seq === undefined
            ? {}
            : { event_seq: sub.nextEventSeq() }),
        },
      });
      await sub.transport.send(forwarded);
    } catch {
      // best-effort
    }
  }

  private maybeEmitBackPressure(): void {
    if (!this.hasFeature("ack")) return;
    const lag = this.eventSeq - this.lastAckedSeq;
    const threshold =
      this.server.options.backPressureThreshold ??
      DEFAULT_BACK_PRESSURE_THRESHOLD;
    if (lag > threshold && !this.backPressureNotified) {
      this.backPressureNotified = true;
      // Best-effort emit — don't fail the outer send if this errors.
      void this.emitBackPressureStatus(lag).catch(() => undefined);
      return;
    }
    if (lag <= threshold / 2 && this.backPressureNotified) {
      this.backPressureNotified = false;
    }
  }

  private async emitBackPressureStatus(lag: number): Promise<void> {
    if (this.closed || this.transport.closed) return;
    if (this.state.id === undefined) return;
    // Emit as a job.event with a synthetic, sessionless status body. We
    // attach it to the most recently created job if any, else skip.
    const live = this.jobs.list();
    if (live.length === 0) return;
    const job = live.at(-1);
    if (job === undefined) return;
    await job.emitEventKind("status", {
      phase: "back_pressure",
      message: `consumer lag ${lag} events`,
    });
  }

  private checkCaps(): void {
    const caps = this.server.options.caps ?? {};
    const maxEvents = caps.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
    const maxBytes = caps.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    if (this.bufferedEventCount > maxEvents || this.bufferedBytes > maxBytes) {
      const err = new InternalError(
        `Session buffer exceeded caps (events=${this.bufferedEventCount}/${maxEvents}, bytes=${this.bufferedBytes}/${maxBytes})`,
        { retryable: false },
      );
      void this.emitSessionError(err);
    }
  }

  /** Emit a `session.error` envelope and close. */
  public async emitSessionError(err: ARCPError): Promise<void> {
    if (this.closed) return;
    try {
      const env = buildEnvelope({
        id: newMessageId(),
        type: "session.error" as const,
        payload: err.toPayload(),
        optional: {
          session_id: this.state.id,
        },
      });
      // Use transport.send directly to avoid the post-close guard rejecting.
      if (!this.transport.closed) {
        await this.transport.send(env);
      }
    } catch {
      // best-effort
    }
    try {
      this.state.transition(this.state.isAccepted ? "closing" : "rejected");
    } catch {
      // already terminal
    }
    await this.terminate(err.message);
  }

  /** Emit a `job.error` envelope on the given job and retire it. */
  public async emitJobError(
    jobId: JobId,
    payload: JobErrorPayload,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job !== undefined) {
      await job.emitErrorEnvelope(payload);
      this.jobs.retire(jobId);
      return;
    }
    // Job-not-found: emit a synthetic envelope so the client can observe it.
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.error" as const,
      payload,
      optional: {
        session_id: this.state.id,
        job_id: jobId,
        event_seq: this.nextEventSeq(),
      },
    });
    await this.send(env);
  }

  /** Dispatch an inbound, raw frame. */
  public async dispatchRaw(frame: WireFrame): Promise<void> {
    this.touch();
    this.lastInboundAt = Date.now();
    const parsed = this.parseInboundFrame(frame);
    if (parsed === null) return;
    if (this.dropPreHandshakeNonHandshake(parsed)) return;
    if (await this.dedupeInbound(parsed)) return;
    const envelope = await this.validateInbound(parsed);
    if (envelope === null) return;
    await this.invokeHandler(envelope);
  }

  private parseInboundFrame(frame: WireFrame): BaseEnvelope | null {
    try {
      return RoundTripEnvelopeSchema.parse(frame);
    } catch (error) {
      this.logger.warn(
        { err: error },
        "inbound envelope failed base-shape validation",
      );
      return null;
    }
  }

  private dropPreHandshakeNonHandshake(parsed: BaseEnvelope): boolean {
    if (this.state.isAccepted || HANDSHAKE_TYPES.has(parsed.type)) return false;
    this.logger.warn(
      { type: parsed.type, id: parsed.id },
      "dropping pre-handshake non-handshake message",
    );
    return true;
  }

  private async dedupeInbound(parsed: BaseEnvelope): Promise<boolean> {
    // v1.1: session.ping/pong/ack are session-control (not event-seq-bearing),
    // so we skip the dedupe-and-log step for them.
    if (
      this.state.id === undefined ||
      parsed.session_id !== this.state.id ||
      INBOUND_DEDUPE_SKIP.has(parsed.type)
    ) {
      return false;
    }
    try {
      const inserted = await this.server.eventLog.append(parsed);
      if (inserted) return false;
      this.logger.debug({ id: parsed.id }, "duplicate inbound, skipping dispatch");
      return true;
    } catch (error) {
      this.logger.error({ err: error }, "event log append (inbound) failed");
      return false;
    }
  }

  private async validateInbound(parsed: BaseEnvelope): Promise<Envelope | null> {
    const result = EnvelopeSchema.safeParse(parsed);
    if (result.success) return result.data;
    const issue = result.error.issues[0];
    if (issue?.code === z.ZodIssueCode.invalid_union_discriminator) {
      await this.handleUnknownTypeDisposition(parsed);
      return null;
    }
    await this.emitSessionError(
      new InvalidRequestError(
        `Invalid envelope: ${issue?.message ?? "schema validation failed"}`,
      ),
    );
    return null;
  }

  private async handleUnknownTypeDisposition(parsed: BaseEnvelope): Promise<void> {
    const disposition = classifyUnknownType(parsed.type, {
      extensionsObject: parsed.extensions,
    });
    if (disposition.kind === "drop") {
      this.logger.debug({ type: parsed.type }, disposition.reason);
      return;
    }
    await this.emitSessionError(
      new InvalidRequestError(disposition.reason, {
        details: { type: parsed.type },
      }),
    );
  }

  private async invokeHandler(envelope: Envelope): Promise<void> {
    const handler = this.handlers.get(envelope.type);
    if (handler === undefined) {
      await this.emitSessionError(
        new InvalidRequestError(`No handler registered for "${envelope.type}"`),
      );
      return;
    }
    try {
      await handler(envelope, this);
    } catch (error) {
      this.logger.error({ err: error, type: envelope.type }, "handler threw");
      const wrapped =
        error instanceof ARCPError
          ? error
          : new InternalError(
              error instanceof Error ? error.message : String(error),
              { cause: error instanceof Error ? error : undefined },
            );
      // Best effort: route through session.error for now.
      await this.emitSessionError(wrapped);
    }
  }

  /** Start the v1.1 §6.4 heartbeat watchdog when the feature is negotiated. */
  public startHeartbeat(): void {
    if (!this.hasFeature("heartbeat")) return;
    const intervalMs =
      (this.server.options.heartbeatIntervalSeconds ??
        DEFAULT_HEARTBEAT_SECONDS) * 1000;
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatTick(intervalMs).catch(() => undefined);
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * §6.4: if no inbound traffic in the last 2 intervals, treat the peer as
   * gone and surface HEARTBEAT_LOST. Otherwise, if our outbound side has
   * been idle for one interval, send a ping.
   */
  private async heartbeatTick(intervalMs: number): Promise<void> {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.lastInboundAt > intervalMs * 2) {
      // Peer silent for two intervals — treat as dead.
      await this.emitSessionError(
        new HeartbeatLostError("Peer silent for 2 heartbeat intervals"),
      );
      return;
    }
    // Only ping if we have not sent or received traffic in `intervalMs`.
    if (now - this.lastMessageAt < intervalMs * 0.9) return;
    // Outbound idle: send a ping.
    const sessionId = this.state.id;
    if (sessionId === undefined) return;
    const nonce = `p_${randomBytes(8).toString("hex")}`;
    this.outstandingPingNonce = nonce;
    const env = buildEnvelope({
      id: newMessageId(),
      type: "session.ping" as const,
      payload: { nonce, sent_at: new Date(now).toISOString() },
      optional: { session_id: sessionId },
    });
    try {
      // Use transport.send to bypass the per-session event_log append
      // (heartbeats are NOT counted in event_seq, §6.4).
      await this.transport.send(env);
      this.lastMessageAt = now;
    } catch {
      // best-effort
    }
  }

  public handlePong(pingNonce: string): void {
    if (this.outstandingPingNonce === pingNonce) {
      this.outstandingPingNonce = null;
    }
  }

  /** Tell the runtime this session is finished. Idempotent. */
  public async terminate(reason?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    // Unsubscribe from every observed job.
    for (const fn of this.subscriptions.values()) {
      try {
        fn();
      } catch {
        // best-effort
      }
    }
    this.subscriptions.clear();
    this.server.dropSession(this);
    await this.transport.close(reason);
  }
}

/**
 * Top-level ARCP runtime/server (§6–§14).
 *
 * Hosts a set of named agents (optionally versioned) and accepts sessions
 * over any {@link Transport}. Each accepted session drives the §6
 * handshake, dispatches `job.submit`/`job.cancel`/`session.bye` and (v1.1)
 * `session.ping`/`session.pong`/`session.ack`/`session.list_jobs`/
 * `job.subscribe`/`job.unsubscribe`, and emits `job.event`/`job.result`/
 * `job.error` envelopes back to the client.
 *
 * One server instance can serve many concurrent sessions. The runtime
 * maintains:
 *
 *   - an event log (for §6.3 resume replay and §7.6 history replay),
 *   - an in-process idempotency store (`(principal, idempotency_key) → job_id`),
 *   - a resume-token store with periodic sweep (§14 window expiry),
 *   - per-session DoS caps (§14),
 *   - a global jobs registry (for §6.6 list and §7.6 subscribe).
 */
export class ARCPServer {
  public readonly eventLog: EventLog;
  public readonly logger: Logger;
  private readonly agentRegistry = new AgentRegistry();
  /** Internal: read by `JobRunner` for idempotency lookups on `job.submit`. */
  public readonly idempotencyStore = new IdempotencyStore();
  private readonly resumeStore = new ResumeStore();
  private readonly jobRunner = new JobRunner(this);
  /** Live sessions, indexed by session_id (only those past welcome). */
  private readonly sessions = new Map<string, SessionContext>();
  /**
   * Global jobs registry for cross-session features (§6.6 listing,
   * §7.6 subscription). Indexed by job_id.
   */
  public readonly globalJobs = new Map<string, Job>();
  /** job_id → set of subscriber SessionContexts. */
  public readonly subscribers = new Map<string, Set<SessionContext>>();
  private resumeSweep: ReturnType<typeof setInterval> | null = null;

  public constructor(public readonly options: ARCPServerOptions) {
    this.eventLog = options.eventLog ?? new EventLog();
    this.logger = options.logger ?? rootLogger;
    this.resumeSweep = setInterval(() => {
      this.sweepResume();
    }, 60_000);
    this.resumeSweep.unref();
  }

  /** v1.1 feature flags this runtime advertises. Defaults to every v1.1 feature. */
  public get advertisedFeatures(): readonly string[] {
    return this.options.features ?? V1_1_FEATURES;
  }

  /**
   * Register an unversioned agent handler. Submissions with a bare `agent`
   * name match this. If a versioned handler is also registered, bare-name
   * submissions resolve to the default version (or the unversioned handler
   * if no default is set).
   */
  public registerAgent<Input = unknown, Result = unknown>(
    name: string,
    handler: AgentHandler<Input, Result>,
  ): void {
    this.agentRegistry.register(name, handler);
  }

  /**
   * v1.1 §7.5 — register a versioned agent handler. The same `name` MAY have
   * multiple versions; use {@link setDefaultAgentVersion} to choose which one
   * resolves for bare-name submissions.
   */
  public registerAgentVersion<Input = unknown, Result = unknown>(
    name: string,
    version: string,
    handler: AgentHandler<Input, Result>,
  ): void {
    this.agentRegistry.registerVersion(name, version, handler);
  }

  /** v1.1 §7.5 — set the default version for bare-name submissions. */
  public setDefaultAgentVersion(name: string, version: string): void {
    this.agentRegistry.setDefaultVersion(name, version);
  }

  public hasAgent(name: string): boolean {
    return this.agentRegistry.has(name);
  }

  /**
   * Resolve a parsed agent reference to a concrete handler. Returns the
   * resolved version (may be empty string for unversioned). Throws
   * `AgentNotAvailableError` / `AgentVersionNotAvailableError` per §7.5.
   */
  public resolveAgent(
    name: string,
    version: string | null,
  ): { handler: AgentHandler; version: string } {
    return this.agentRegistry.resolve(name, version);
  }

  /** Build the rich agent inventory shape (§6.2 / §7.5) for advertisement. */
  public getAgentInventory(): AgentInventoryEntry[] {
    return this.agentRegistry.inventory();
  }

  /**
   * Adopt a {@link Transport} as a new session. Returns the
   * {@link SessionContext}; the handshake completes asynchronously.
   */
  public accept(transport: Transport): SessionContext {
    const ctx = new SessionContext(transport, this, this.logger);
    transport.onFrame((frame) => ctx.dispatchRaw(frame));
    transport.onClose(() => {
      const terminal: ReadonlySet<string> = new Set(["rejected", "closing"]);
      if (terminal.has(ctx.state.phase)) return;
      if (ctx.state.isAccepted) {
        ctx.state.transition("closing");
      } else {
        ctx.state.transition("rejected");
      }
    });
    this.registerHandshakeHandlers(ctx);
    return ctx;
  }

  /** Close the runtime and the underlying event log. */
  public async close(): Promise<void> {
    if (this.resumeSweep !== null) {
      clearInterval(this.resumeSweep);
      this.resumeSweep = null;
    }
    await this.eventLog.close();
  }

  /** Internal: drop a session from the live map. */
  public dropSession(ctx: SessionContext): void {
    const id = ctx.state.id;
    if (id !== undefined) this.sessions.delete(id);
  }

  // ---------------------------------------------------------------------
  // Handshake
  // ---------------------------------------------------------------------

  private registerHandshakeHandlers(ctx: SessionContext): void {
    ctx.registerHandler("session.hello", async (env) => {
      await this.handleSessionHello(ctx, env);
    });
  }

  private async handleSessionHello(
    ctx: SessionContext,
    env: Envelope,
  ): Promise<void> {
    if (env.type !== "session.hello") return;
    if (ctx.state.phase !== "opening") {
      await ctx.emitSessionError(
        new InvalidRequestError("session.hello received in non-opening phase"),
      );
      return;
    }
    const identity = await this.authenticateHello(ctx, env.payload);
    if (identity === null) return;
    if (env.payload.resume !== undefined) {
      await this.handleResume(ctx, identity, env.payload);
      return;
    }
    await this.acceptFreshSession(ctx, identity, env.payload);
  }

  private async authenticateHello(
    ctx: SessionContext,
    payload: SessionHelloPayload,
  ): Promise<BearerIdentity | null> {
    try {
      return await this.authenticate(payload.auth);
    } catch (error) {
      const wrapped =
        error instanceof ARCPError
          ? error
          : new UnauthenticatedError("Auth failed");
      ctx.logger.info(
        { scheme: payload.auth.scheme },
        "rejecting session.hello (auth)",
      );
      await ctx.emitSessionError(wrapped);
      return null;
    }
  }

  private async acceptFreshSession(
    ctx: SessionContext,
    identity: BearerIdentity,
    payload: SessionHelloPayload,
  ): Promise<void> {
    const sessionId = newSessionId();
    ctx.state.assignId(sessionId);
    ctx.state.assignIdentity(identity);
    const negotiated = this.makeNegotiatedCapabilities(payload, ctx);
    ctx.state.assignCapabilities(negotiated);
    this.bindLogger(ctx, payload.client.name);
    const resumeWindowSec =
      this.options.resumeWindowSeconds ?? DEFAULT_RESUME_WINDOW_SECONDS;
    const resumeToken = newResumeToken();
    this.resumeStore.set(sessionId, {
      sessionId,
      resumeToken,
      expiresAt: Date.now() + resumeWindowSec * 1000,
    });
    const welcome = this.buildWelcomePayload(ctx, negotiated, {
      resumeToken,
      resumeWindowSec,
    });
    ctx.state.transition("accepted");
    this.sessions.set(sessionId, ctx);
    await ctx.send(
      buildEnvelope({
        id: newMessageId(),
        type: "session.welcome" as const,
        payload: welcome,
        optional: { session_id: sessionId },
      }),
    );
    ctx.logger.info(
      { session_id: sessionId, principal: identity.principal },
      "session welcomed",
    );
    this.registerPostHandshakeHandlers(ctx);
    ctx.startHeartbeat();
  }

  private buildWelcomePayload(
    ctx: SessionContext,
    negotiated: Capabilities,
    args: {
      resumeToken: ReturnType<typeof newResumeToken>;
      resumeWindowSec: number;
    },
  ): SessionWelcomePayload {
    const heartbeatSec =
      this.options.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_SECONDS;
    return {
      runtime: this.options.runtime,
      resume_token: args.resumeToken,
      resume_window_sec: args.resumeWindowSec,
      ...(ctx.hasFeature("heartbeat")
        ? { heartbeat_interval_sec: heartbeatSec }
        : {}),
      capabilities: negotiated,
    };
  }

  /**
   * Build the welcome capabilities: intersect features with the client's
   * advertised list and store the result on the session context.
   */
  private makeNegotiatedCapabilities(
    payload: SessionHelloPayload,
    ctx: SessionContext,
  ): Capabilities {
    const base: Capabilities = { ...this.options.capabilities };
    // Advertise the rich agent inventory shape when the agent_versions
    // feature is negotiated and we have versioned handlers; else fall back to
    // the v1.0 flat shape (or what the caller supplied).
    const clientFeatures = payload.capabilities?.features;
    const features = intersectFeatures(this.advertisedFeatures, clientFeatures);
    ctx.assignNegotiatedFeatures(features);

    if (features.includes("agent_versions") || base.agents === undefined) {
      const inventory = this.getAgentInventory();
      if (inventory.length > 0) {
        base.agents = inventory;
      }
    }
    if (features.length > 0) {
      base.features = features;
    }

    return negotiateCapabilities(payload.capabilities, base);
  }

  private async handleResume(
    ctx: SessionContext,
    identity: BearerIdentity,
    payload: SessionHelloPayload,
  ): Promise<void> {
    const resume = payload.resume;
    if (resume === undefined) {
      await ctx.emitSessionError(
        new InvalidRequestError("handleResume called without resume payload"),
      );
      return;
    }
    if (ctx.state.id === undefined) ctx.state.assignId(resume.session_id);
    if (!(await this.validateResumeRecord(ctx, resume))) return;
    this.rebindResumedSession(ctx, identity, payload);
    const freshToken = this.rotateResumeToken(resume.session_id);
    await this.sendResumeWelcome(ctx, freshToken, resume.session_id);
    await this.replayResumeEvents(ctx, resume);
    ctx.logger.info(
      { session_id: resume.session_id, replayed_from: resume.last_event_seq },
      "session resumed",
    );
    this.registerPostHandshakeHandlers(ctx);
    ctx.startHeartbeat();
  }

  private async validateResumeRecord(
    ctx: SessionContext,
    resume: NonNullable<SessionHelloPayload["resume"]>,
  ): Promise<boolean> {
    const record = this.resumeStore.get(resume.session_id);
    if (record?.resumeToken !== resume.resume_token) {
      await ctx.emitSessionError(
        new ResumeWindowExpiredError("Invalid or unknown resume_token"),
      );
      return false;
    }
    if (record.expiresAt < Date.now()) {
      this.resumeStore.delete(resume.session_id);
      await ctx.emitSessionError(
        new ResumeWindowExpiredError("Resume window has expired"),
      );
      return false;
    }
    return true;
  }

  private rebindResumedSession(
    ctx: SessionContext,
    identity: BearerIdentity,
    payload: SessionHelloPayload,
  ): void {
    const resume = payload.resume;
    if (resume === undefined) return;
    const sessionId = resume.session_id;
    // Detach any in-memory session bound to that id (e.g., a dropped socket).
    const prior = this.sessions.get(sessionId);
    if (prior !== undefined && prior !== ctx) this.sessions.delete(sessionId);
    ctx.state.assignId(sessionId);
    ctx.state.assignIdentity(identity);
    const negotiated = this.makeNegotiatedCapabilities(payload, ctx);
    ctx.state.assignCapabilities(negotiated);
    this.bindLogger(ctx, payload.client.name);
  }

  private rotateResumeToken(
    sessionId: SessionId,
  ): ReturnType<typeof newResumeToken> {
    const resumeWindowSec =
      this.options.resumeWindowSeconds ?? DEFAULT_RESUME_WINDOW_SECONDS;
    const freshToken = newResumeToken();
    this.resumeStore.set(sessionId, {
      sessionId,
      resumeToken: freshToken,
      expiresAt: Date.now() + resumeWindowSec * 1000,
    });
    return freshToken;
  }

  private async sendResumeWelcome(
    ctx: SessionContext,
    freshToken: ReturnType<typeof newResumeToken>,
    sessionId: SessionId,
  ): Promise<void> {
    const resumeWindowSec =
      this.options.resumeWindowSeconds ?? DEFAULT_RESUME_WINDOW_SECONDS;
    const welcome = this.buildWelcomePayload(
      ctx,
      ctx.state.capabilities ?? {},
      { resumeToken: freshToken, resumeWindowSec },
    );
    ctx.state.transition("accepted");
    this.sessions.set(sessionId, ctx);
    await ctx.send(
      buildEnvelope({
        id: newMessageId(),
        type: "session.welcome" as const,
        payload: welcome,
        optional: { session_id: sessionId },
      }),
    );
  }

  private async replayResumeEvents(
    ctx: SessionContext,
    resume: NonNullable<SessionHelloPayload["resume"]>,
  ): Promise<void> {
    try {
      const replayed = await this.eventLog.readSinceSeq(
        resume.session_id,
        resume.last_event_seq,
        10_000,
      );
      let highest = resume.last_event_seq;
      for (const env of replayed) {
        if (env.event_seq !== undefined && env.event_seq > highest) {
          highest = env.event_seq;
        }
        await ctx.transport.send(env);
      }
      ctx.setEventSeq(highest);
    } catch (error) {
      ctx.logger.warn({ err: error }, "resume replay failed");
    }
  }

  private bindLogger(ctx: SessionContext, clientName: string): void {
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    ctx.logger = makeSessionLogger(this.logger, sessionId).child({
      client: clientName,
    });
  }

  private registerPostHandshakeHandlers(ctx: SessionContext): void {
    this.registerJobLifecycleHandlers(ctx);
    this.registerSessionControlHandlers(ctx);
    this.registerListJobsHandler(ctx);
    this.registerSubscriptionHandlers(ctx);
  }

  private registerJobLifecycleHandlers(ctx: SessionContext): void {
    ctx.registerHandler("job.submit", async (env) => {
      if (env.type !== "job.submit") return;
      await this.jobRunner.handleJobSubmit(ctx, env);
    });
    ctx.registerHandler("job.cancel", async (env) => {
      if (env.type !== "job.cancel") return;
      await this.handleJobCancel(ctx, env);
    });
    ctx.registerHandler("session.bye", async (env) => {
      if (env.type !== "session.bye") return;
      ctx.jobs.cancelAll("session closed");
      try {
        ctx.state.transition("closing");
      } catch {
        // already in terminal phase
      }
      await ctx.terminate(env.payload.reason);
    });
  }

  private registerSessionControlHandlers(ctx: SessionContext): void {
    // v1.1 §6.4 — heartbeat (handled even if not negotiated; receivers always
    // respond to ping per §6.4 to support staggered rollouts).
    ctx.registerHandler("session.ping", async (env) => {
      if (env.type !== "session.ping") return;
      const sessionId = ctx.state.id;
      if (sessionId === undefined) return;
      // Direct transport.send — heartbeats are NOT counted in event_seq.
      await ctx.transport.send(
        buildEnvelope({
          id: newMessageId(),
          type: "session.pong" as const,
          payload: {
            ping_nonce: env.payload.nonce,
            received_at: new Date().toISOString(),
          },
          optional: { session_id: sessionId },
        }),
      );
    });
    ctx.registerHandler("session.pong", (env) => {
      if (env.type !== "session.pong") return;
      ctx.handlePong(env.payload.ping_nonce);
    });
    // v1.1 §6.5 — event acknowledgement.
    ctx.registerHandler("session.ack", (env) => {
      if (env.type !== "session.ack") return;
      if (!ctx.hasFeature("ack")) return;
      ctx.recordAck(env.payload.last_processed_seq);
    });
  }

  private registerListJobsHandler(ctx: SessionContext): void {
    // v1.1 §6.6 — job listing.
    ctx.registerHandler("session.list_jobs", async (env) => {
      if (env.type !== "session.list_jobs") return;
      if (!ctx.hasFeature("list_jobs")) {
        await ctx.emitSessionError(
          new InvalidRequestError(
            "session.list_jobs requires the 'list_jobs' feature",
          ),
        );
        return;
      }
      await this.handleListJobs(ctx, env);
    });
  }

  private registerSubscriptionHandlers(ctx: SessionContext): void {
    // v1.1 §7.6 — subscription.
    ctx.registerHandler("job.subscribe", async (env) => {
      if (env.type !== "job.subscribe") return;
      if (!ctx.hasFeature("subscribe")) {
        await ctx.emitSessionError(
          new InvalidRequestError(
            "job.subscribe requires the 'subscribe' feature",
          ),
        );
        return;
      }
      await this.handleJobSubscribe(ctx, env);
    });
    ctx.registerHandler("job.unsubscribe", (env) => {
      if (env.type !== "job.unsubscribe") return;
      if (!ctx.hasFeature("subscribe")) return;
      const jobId = env.payload.job_id;
      const stop = ctx.subscriptions.get(jobId);
      if (stop !== undefined) {
        stop();
        ctx.subscriptions.delete(jobId);
      }
    });
  }

  // §7 Jobs: handleJobSubmit and the run-loop live in ./job-runner.ts.

  private async handleJobCancel(
    ctx: SessionContext,
    env: Envelope,
  ): Promise<void> {
    if (env.type !== "job.cancel") return;
    const jobId = env.job_id;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (jobId === undefined) {
      await ctx.emitSessionError(
        new InvalidRequestError("job.cancel requires job_id"),
      );
      return;
    }
    const job = ctx.jobs.get(jobId);
    if (job === undefined) {
      await this.emitCancelTargetMissing(ctx, jobId);
      return;
    }
    if (job.isTerminal) return;
    job.cancel(env.payload.reason ?? "client_cancel");
    this.scheduleCancelGrace(job);
  }

  private async emitCancelTargetMissing(
    ctx: SessionContext,
    jobId: JobId,
  ): Promise<void> {
    // v1.1 §7.6 — subscription does NOT grant cancel authority. If the job
    // exists but this session is only a subscriber, refuse with
    // PERMISSION_DENIED rather than masquerading as JOB_NOT_FOUND.
    if (this.globalJobs.get(jobId) !== undefined) {
      await ctx.emitJobError(jobId, {
        final_status: "error",
        code: "PERMISSION_DENIED",
        message: "Subscription does not confer cancel authority",
        retryable: false,
      });
      return;
    }
    await ctx.emitJobError(jobId, {
      final_status: "error",
      code: "JOB_NOT_FOUND",
      message: `Job "${jobId}" not found in this session`,
      retryable: false,
    });
  }

  private scheduleCancelGrace(job: Job): void {
    // §7.4: default 30s; force-emit cancelled error on expiry.
    const graceMs = this.options.cancelGraceMs ?? DEFAULT_GRACE_MS;
    const timer = setTimeout(() => {
      if (job.isTerminal) return;
      void job.emitErrorEnvelope({
        final_status: "cancelled",
        code: "CANCELLED",
        message: `Cancellation grace expired (${graceMs}ms)`,
        retryable: false,
      });
    }, graceMs);
    timer.unref();
  }

  // ---------------------------------------------------------------------
  // v1.1 §6.6 — session.list_jobs
  // ---------------------------------------------------------------------

  private async handleListJobs(
    ctx: SessionContext,
    env: Envelope,
  ): Promise<void> {
    if (env.type !== "session.list_jobs") return;
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    const candidates = this.buildListJobsCandidates(ctx, env.payload.filter);
    candidates.sort(compareJobListEntries);
    const { page, nextCursor } = paginateJobList(
      candidates,
      env.payload.cursor ?? undefined,
      env.payload.limit ?? 100,
    );
    await ctx.send(
      buildEnvelope({
        id: newMessageId(),
        type: "session.jobs" as const,
        payload: { request_id: env.id, jobs: page, next_cursor: nextCursor },
        optional: { session_id: sessionId },
      }),
    );
  }

  private buildListJobsCandidates(
    ctx: SessionContext,
    rawFilter: SessionListJobsFilter | undefined,
  ): JobListEntry[] {
    const principal = ctx.state.identity?.principal;
    const policy =
      this.options.jobAuthorizationPolicy ?? defaultJobAuthorizationPolicy;
    const filter: ListJobsFilter = compileListJobsFilter(rawFilter ?? {});
    const out: JobListEntry[] = [];
    for (const job of this.globalJobs.values()) {
      if (!policy(job, principal)) continue;
      if (!filter.matches(job)) continue;
      out.push({
        job_id: job.jobId,
        agent: job.agentRef,
        status: job.state,
        lease: job.lease,
        parent_job_id: job.parentJobId ?? null,
        created_at: job.createdAt,
        ...(job.traceId === undefined ? {} : { trace_id: job.traceId }),
        last_event_seq: ctx.latestEventSeq,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // v1.1 §7.6 — job.subscribe
  // ---------------------------------------------------------------------

  private async handleJobSubscribe(
    ctx: SessionContext,
    env: Envelope,
  ): Promise<void> {
    if (env.type !== "job.subscribe") return;
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    const jobId = env.payload.job_id;
    const job = this.globalJobs.get(jobId);
    if (job === undefined) {
      await ctx.emitJobError(jobId, {
        final_status: "error",
        code: "JOB_NOT_FOUND",
        message: `Job "${jobId}" not found`,
        retryable: false,
      });
      return;
    }
    if (!this.authorizeSubscribe(ctx, job)) {
      await ctx.emitSessionError(
        new PermissionDeniedError(
          "Subscriber's principal is not authorized to observe this job",
        ),
      );
      return;
    }
    this.registerSubscriber(ctx, jobId);
    const replayed =
      env.payload.history === true
        ? await this.replaySubscribeHistory(ctx, job, env.payload.from_event_seq)
        : false;
    await ctx.send(
      buildEnvelope({
        id: newMessageId(),
        type: "job.subscribed" as const,
        payload: buildSubscribedPayload(job, ctx.latestEventSeq, replayed),
        optional: { session_id: sessionId, job_id: jobId },
      }),
    );
  }

  private authorizeSubscribe(ctx: SessionContext, job: Job): boolean {
    const principal = ctx.state.identity?.principal;
    const policy =
      this.options.jobAuthorizationPolicy ?? defaultJobAuthorizationPolicy;
    return policy(job, principal);
  }

  private registerSubscriber(ctx: SessionContext, jobId: JobId): void {
    let set = this.subscribers.get(jobId);
    if (set === undefined) {
      set = new Set<SessionContext>();
      this.subscribers.set(jobId, set);
    }
    set.add(ctx);
    ctx.subscriptions.set(jobId, () => {
      const s = this.subscribers.get(jobId);
      if (s === undefined) return;
      s.delete(ctx);
      if (s.size === 0) this.subscribers.delete(jobId);
    });
  }

  private async replaySubscribeHistory(
    ctx: SessionContext,
    job: Job,
    fromSeq: number | undefined,
  ): Promise<boolean> {
    if (job.owningSession === undefined) return false;
    const ownerSessionId = job.owningSession.state.id;
    if (ownerSessionId === undefined) return false;
    try {
      const events = await this.eventLog.readSinceSeq(
        ownerSessionId,
        fromSeq ?? 0,
        10_000,
      );
      for (const e of events) {
        if (!isReplayableForJob(e, job.jobId)) continue;
        await forwardEventToSubscriber(ctx, e);
      }
      return events.some((e) => e.job_id === job.jobId);
    } catch (error) {
      ctx.logger.warn({ err: error }, "subscribe history replay failed");
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------

  private async authenticate(
    auth: SessionHelloPayload["auth"],
  ): Promise<BearerIdentity> {
    // Bearer is the only scheme today; future schemes will widen this union.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (auth.scheme === "bearer") {
      const verifier = this.options.bearer;
      if (verifier === undefined) {
        throw new InvalidRequestError(
          "Runtime has no bearer verifier configured",
        );
      }
      if (auth.token === undefined) {
        throw new UnauthenticatedError("bearer scheme requires `token`");
      }
      return verifier.verify(auth.token);
    }
    throw new InvalidRequestError(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `Auth scheme "${auth.scheme}" not supported`,
    );
  }

  // ---------------------------------------------------------------------
  // Internal sweeps
  // ---------------------------------------------------------------------

  private sweepResume(): void {
    const now = Date.now();
    this.resumeStore.sweep(now);
    // Also expire idle sessions past the window.
    const windowMs =
      (this.options.resumeWindowSeconds ?? DEFAULT_RESUME_WINDOW_SECONDS) *
      1000;
    for (const ctx of this.sessions.values()) {
      if (now - ctx.lastActivityAt > windowMs) {
        void ctx.emitSessionError(
          new ResumeWindowExpiredError("session idle past resume_window_sec"),
        );
      }
    }
  }

  // §10 delegation child-job creation lives on `JobRunner` in ./job-runner.ts.
}

// Job's `submitterPrincipal` and `owningSession` fields are declared in
// `./job.ts` (Job class definition) for §6.6/§7.6 cross-session features.
