import { randomBytes } from "node:crypto";
import type { BearerIdentity, BearerVerifier } from "@arcp/core/auth";
import {
  type BaseEnvelope,
  buildEnvelope,
  RoundTripEnvelopeSchema,
} from "@arcp/core/envelope";
import {
  AgentNotAvailableError,
  ARCPError,
  CancelledError,
  InternalError,
  InvalidRequestError,
  LeaseSubsetViolationError,
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
  type Capabilities,
  type DelegateBody,
  type Envelope,
  EnvelopeSchema,
  type JobErrorPayload,
  type JobSubmitPayload,
  type Lease,
  type RuntimeIdentity,
  type SessionHelloPayload,
  type SessionWelcomePayload,
} from "@arcp/core/messages";
import {
  negotiateCapabilities,
  PendingRegistry,
  SessionState,
} from "@arcp/core/state";
import { EventLog } from "@arcp/core/store";
import type { Transport, WireFrame } from "@arcp/core/transport";
import { newJobId, newMessageId, newSessionId } from "@arcp/core/util";
import { z } from "zod";
import {
  type AgentHandler,
  type EventSeqSource,
  Job,
  type JobContext,
  JobManager,
  makeJobContext,
} from "./job.js";
import { assertLeaseSubset, validateLeaseShape } from "./lease.js";

// ARCP v1.0 §6-§14 runtime.
//
// Single message dispatch: session.hello → session.welcome | session.error.
// Post-welcome: job.submit, job.cancel, session.bye. Outbound: job.accepted,
// job.event, job.result, job.error, session.welcome, session.bye, session.error.

const HANDSHAKE_TYPES = new Set<string>(["session.hello"]);

const DEFAULT_HEARTBEAT_SECONDS = 30;
const DEFAULT_RESUME_WINDOW_SECONDS = 600;
const DEFAULT_GRACE_MS = 30_000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BUFFERED_EVENTS = 10_000;
const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024; // 16 MiB
const DEFAULT_MAX_CONCURRENT_JOBS = 100;

/** Inbound-message dispatcher signature. */
export type Handler = (
  env: Envelope,
  ctx: SessionContext,
) => Promise<void> | void;

/** Top-level server options. */
export interface ARCPServerOptions {
  /** Identity broadcast in `session.welcome`. */
  runtime: RuntimeIdentity;
  /** Capabilities advertised by this runtime. */
  capabilities: Capabilities;
  /** Bearer-token verifier. Required in v1.0. */
  bearer?: BearerVerifier;
  /** Event log to persist envelopes. Defaults to an in-memory log. */
  eventLog?: EventLog;
  /** Logger. Defaults to {@link rootLogger}. */
  logger?: Logger;
  /** Heartbeat watchdog interval. Default 30 s. */
  heartbeatIntervalSeconds?: number;
  /** Resume buffer window. Default 600 s. */
  resumeWindowSeconds?: number;
  /** Cancellation grace period before forced termination. Default 30_000 ms. */
  cancelGraceMs?: number;
  /** Idempotency cache TTL. Default 24 h. */
  idempotencyTtlMs?: number;
  /** Per-session DoS caps. */
  caps?: SessionCaps;
}

/**
 * Per-session DoS / resource caps (§14).
 *
 * Defaults: 10_000 buffered events, 16 MiB buffered bytes, 100 concurrent
 * jobs. Exceeding any cap closes the session with `INTERNAL_ERROR`
 * (non-retryable).
 */
export interface SessionCaps {
  /** Max number of outbound envelopes buffered in the event log per session. */
  maxBufferedEvents?: number;
  /** Max number of outbound envelope bytes buffered per session. */
  maxBufferedBytes?: number;
  /** Max number of concurrent jobs in a single session. */
  maxConcurrentJobs?: number;
}

interface IdempotencyEntry {
  jobId: string;
  agent: string;
  inputDigest: string;
  expiresAt: number;
}

interface ResumeRecord {
  sessionId: string;
  resumeToken: string;
  expiresAt: number;
}

function digest(input: unknown): string {
  return JSON.stringify(input);
}

function newResumeToken(): string {
  return `rt_${randomBytes(32).toString("hex")}`;
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
  /** Active idempotent keys for jobs that resolved through this session. */
  private readonly localKeys = new Set<string>();

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
  public nextEventSeq(): number {
    this.eventSeq += 1;
    return this.eventSeq;
  }

  public get latestEventSeq(): number {
    return this.eventSeq;
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

  public addLocalIdempotencyKey(key: string): void {
    this.localKeys.add(key);
  }

  public hasLocalIdempotencyKey(key: string): boolean {
    return this.localKeys.has(key);
  }

  /** Send an envelope through the transport. */
  public async send(envelope: BaseEnvelope): Promise<void> {
    if (this.closed || this.transport.closed) {
      throw new InvalidRequestError("Cannot send: session closed");
    }
    this.touch();
    await this.transport.send(envelope);
    if (envelope.session_id !== undefined && envelope.session_id !== "") {
      try {
        await this.server.eventLog.append(envelope);
        // Account against per-session caps for replay buffer estimation.
        const size = JSON.stringify(envelope).length;
        this.bufferedEventCount += 1;
        this.bufferedBytes += size;
        this.checkCaps();
      } catch (err) {
        this.logger.error({ err }, "event log append (outbound) failed");
      }
    }
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
    } catch (_e) {
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
    jobId: string,
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
    let parsed: BaseEnvelope;
    try {
      parsed = RoundTripEnvelopeSchema.parse(frame);
    } catch (err) {
      this.logger.warn(
        { err },
        "inbound envelope failed base-shape validation",
      );
      return;
    }

    // Pre-handshake: drop non-handshake messages.
    if (!this.state.isAccepted && !HANDSHAKE_TYPES.has(parsed.type)) {
      this.logger.warn(
        { type: parsed.type, id: parsed.id },
        "dropping pre-handshake non-handshake message",
      );
      return;
    }

    // Idempotent inbound: dedupe by (session_id, id) once a session exists.
    if (this.state.id !== undefined && parsed.session_id === this.state.id) {
      try {
        const inserted = await this.server.eventLog.append(parsed);
        if (!inserted) {
          this.logger.debug(
            { id: parsed.id },
            "duplicate inbound, skipping dispatch",
          );
          return;
        }
      } catch (err) {
        this.logger.error({ err }, "event log append (inbound) failed");
      }
    }

    // Validate against the discriminated union.
    const result = EnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const looksUnknownType =
        issue?.code === z.ZodIssueCode.invalid_union_discriminator;
      if (looksUnknownType) {
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
        return;
      }
      await this.emitSessionError(
        new InvalidRequestError(
          `Invalid envelope: ${issue?.message ?? "schema validation failed"}`,
        ),
      );
      return;
    }
    const envelope = result.data;

    const handler = this.handlers.get(envelope.type);
    if (handler === undefined) {
      await this.emitSessionError(
        new InvalidRequestError(`No handler registered for "${envelope.type}"`),
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
          : new InternalError(
              err instanceof Error ? err.message : String(err),
              {
                cause: err instanceof Error ? err : undefined,
              },
            );
      // Best effort: route through session.error for now.
      await this.emitSessionError(wrapped);
    }
  }

  /** Tell the runtime this session is finished. Idempotent. */
  public async terminate(reason?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.server.dropSession(this);
    await this.transport.close(reason);
  }
}

/**
 * Top-level ARCP runtime/server (§6–§14).
 *
 * Hosts a set of named agents and accepts sessions over any
 * {@link Transport}. Each accepted session drives the §6 handshake,
 * dispatches `job.submit`/`job.cancel`/`session.bye`, and emits
 * `job.event`/`job.result`/`job.error` envelopes back to the client.
 *
 * One server instance can serve many concurrent sessions. The runtime
 * maintains:
 *
 *   - an event log (for §6.3 resume replay),
 *   - an in-process idempotency store (`(principal, idempotency_key) → job_id`),
 *   - a resume-token store with periodic sweep (§14 window expiry),
 *   - per-session DoS caps (§14).
 */
export class ARCPServer {
  public readonly eventLog: EventLog;
  public readonly logger: Logger;
  private readonly agents = new Map<string, AgentHandler>();
  /** principal+key → IdempotencyEntry */
  private readonly idempotencyStore = new Map<string, IdempotencyEntry>();
  /** session_id → ResumeRecord */
  private readonly resumeStore = new Map<string, ResumeRecord>();
  /** Live sessions, indexed by session_id (only those past welcome). */
  private readonly sessions = new Map<string, SessionContext>();
  private resumeSweep: ReturnType<typeof setInterval> | null = null;

  public constructor(public readonly options: ARCPServerOptions) {
    this.eventLog = options.eventLog ?? new EventLog();
    this.logger = options.logger ?? rootLogger;
    this.resumeSweep = setInterval(() => this.sweepResume(), 60_000);
    this.resumeSweep.unref();
  }

  /**
   * Register an agent handler. Agents are looked up by `agent` name on
   * `job.submit`. Re-registering overwrites the previous handler.
   */
  public registerAgent<Input = unknown, Result = unknown>(
    name: string,
    handler: AgentHandler<Input, Result>,
  ): void {
    this.agents.set(name, handler as AgentHandler);
  }

  public hasAgent(name: string): boolean {
    return this.agents.has(name);
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
    const payload = env.payload as SessionHelloPayload;

    let identity: BearerIdentity;
    try {
      identity = await this.authenticate(payload.auth);
    } catch (err) {
      const wrapped =
        err instanceof ARCPError
          ? err
          : new UnauthenticatedError("Auth failed");
      ctx.logger.info(
        { scheme: payload.auth.scheme },
        "rejecting session.hello (auth)",
      );
      await ctx.emitSessionError(wrapped);
      return;
    }

    // Resume path: validate token & seq, replay events, rotate token.
    if (payload.resume !== undefined) {
      await this.handleResume(ctx, identity, payload);
      return;
    }

    // Fresh session: assign id, transition, issue welcome with fresh token.
    const sessionId = newSessionId();
    ctx.state.assignId(sessionId);
    ctx.state.assignIdentity(identity);
    const negotiated = negotiateCapabilities(
      payload.capabilities,
      this.options.capabilities,
    );
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

    const welcome: SessionWelcomePayload = {
      runtime: this.options.runtime,
      resume_token: resumeToken,
      resume_window_sec: resumeWindowSec,
      capabilities: negotiated,
    };
    const welcomeEnv = buildEnvelope({
      id: newMessageId(),
      type: "session.welcome" as const,
      payload: welcome,
      optional: {
        session_id: sessionId,
      },
    });
    ctx.state.transition("accepted");
    this.sessions.set(sessionId, ctx);
    await ctx.send(welcomeEnv);
    ctx.logger.info(
      { session_id: sessionId, principal: identity.principal },
      "session welcomed",
    );
    this.registerPostHandshakeHandlers(ctx);
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
    // Tentatively bind the session id so any failure-path session.error
    // envelope still carries session_id per §5.1.
    if (ctx.state.id === undefined) ctx.state.assignId(resume.session_id);
    const record = this.resumeStore.get(resume.session_id);
    if (record === undefined || record.resumeToken !== resume.resume_token) {
      await ctx.emitSessionError(
        new ResumeWindowExpiredError("Invalid or unknown resume_token"),
      );
      return;
    }
    if (record.expiresAt < Date.now()) {
      this.resumeStore.delete(resume.session_id);
      await ctx.emitSessionError(
        new ResumeWindowExpiredError("Resume window has expired"),
      );
      return;
    }

    // Detach any in-memory session bound to that id (e.g., a dropped socket).
    const prior = this.sessions.get(resume.session_id);
    if (prior !== undefined && prior !== ctx) {
      this.sessions.delete(resume.session_id);
    }

    ctx.state.assignId(resume.session_id);
    ctx.state.assignIdentity(identity);
    const negotiated = negotiateCapabilities(
      payload.capabilities,
      this.options.capabilities,
    );
    ctx.state.assignCapabilities(negotiated);
    this.bindLogger(ctx, payload.client.name);

    // Rotate the resume_token; the old token is single-use and now invalid.
    const resumeWindowSec =
      this.options.resumeWindowSeconds ?? DEFAULT_RESUME_WINDOW_SECONDS;
    const freshToken = newResumeToken();
    this.resumeStore.set(resume.session_id, {
      sessionId: resume.session_id,
      resumeToken: freshToken,
      expiresAt: Date.now() + resumeWindowSec * 1000,
    });

    const welcome: SessionWelcomePayload = {
      runtime: this.options.runtime,
      resume_token: freshToken,
      resume_window_sec: resumeWindowSec,
      capabilities: negotiated,
    };
    const welcomeEnv = buildEnvelope({
      id: newMessageId(),
      type: "session.welcome" as const,
      payload: welcome,
      optional: { session_id: resume.session_id },
    });
    ctx.state.transition("accepted");
    this.sessions.set(resume.session_id, ctx);
    await ctx.send(welcomeEnv);

    // Replay events strictly greater than `last_event_seq`.
    try {
      const replayed = await this.eventLog.readSinceSeq(
        resume.session_id,
        resume.last_event_seq,
        10_000,
      );
      // Track highest replayed seq so future emits continue monotonic.
      let highest = resume.last_event_seq;
      for (const env of replayed) {
        if (env.event_seq !== undefined && env.event_seq > highest) {
          highest = env.event_seq;
        }
        await ctx.transport.send(env);
      }
      ctx.setEventSeq(highest);
    } catch (err) {
      ctx.logger.warn({ err }, "resume replay failed");
    }

    ctx.logger.info(
      { session_id: resume.session_id, replayed_from: resume.last_event_seq },
      "session resumed",
    );
    this.registerPostHandshakeHandlers(ctx);
  }

  private bindLogger(ctx: SessionContext, clientName: string): void {
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    ctx.logger = makeSessionLogger(this.logger, sessionId).child({
      client: clientName,
    });
  }

  private registerPostHandshakeHandlers(ctx: SessionContext): void {
    ctx.registerHandler("job.submit", async (env) => {
      if (env.type !== "job.submit") return;
      await this.handleJobSubmit(ctx, env);
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
    // Allow client to re-send a hello during the same transport (resume in-place).
    // Not common, but the spec doesn't forbid it.
  }

  // ---------------------------------------------------------------------
  // §7 Jobs
  // ---------------------------------------------------------------------

  private async handleJobSubmit(
    ctx: SessionContext,
    env: Envelope,
  ): Promise<void> {
    if (env.type !== "job.submit") return;
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    const payload = env.payload as JobSubmitPayload;

    // Per-session max concurrent jobs cap (§14).
    const caps = this.options.caps ?? {};
    const maxConcurrent = caps.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;
    if (ctx.jobs.list().length >= maxConcurrent) {
      await ctx.emitSessionError(
        new InternalError("Max concurrent jobs reached", { retryable: false }),
      );
      return;
    }

    // Agent lookup.
    const handler = this.agents.get(payload.agent);
    if (handler === undefined) {
      const jobId = newJobId();
      await ctx.emitJobError(jobId, {
        final_status: "error",
        code: "AGENT_NOT_AVAILABLE",
        message: `Agent "${payload.agent}" is not registered`,
        retryable: false,
      });
      return;
    }

    // Lease validation.
    const requestedLease: Lease = payload.lease_request ?? {};
    try {
      validateLeaseShape(requestedLease);
    } catch (err) {
      const wrapped =
        err instanceof ARCPError ? err : new InvalidRequestError(String(err));
      await ctx.emitJobError(newJobId(), {
        final_status: "error",
        code: wrapped.code,
        message: wrapped.message,
        retryable: wrapped.retryable,
      });
      return;
    }

    // Idempotency: keyed by (principal, idempotency_key).
    const principal = ctx.state.identity?.principal ?? "<anonymous>";
    let idempotencyHit: IdempotencyEntry | null = null;
    if (payload.idempotency_key !== undefined) {
      const key = `${principal}::${payload.idempotency_key}`;
      this.sweepIdempotency();
      const existing = this.idempotencyStore.get(key);
      if (existing !== undefined && existing.expiresAt > Date.now()) {
        const sameAgent = existing.agent === payload.agent;
        const sameInput = existing.inputDigest === digest(payload.input);
        if (!sameAgent || !sameInput) {
          await ctx.emitJobError(existing.jobId, {
            final_status: "error",
            code: "DUPLICATE_KEY",
            message: `idempotency_key "${payload.idempotency_key}" reused with conflicting params`,
            retryable: false,
            details: { existing_job_id: existing.jobId },
          });
          return;
        }
        idempotencyHit = existing;
      } else {
        ctx.addLocalIdempotencyKey(key);
      }
    }

    // Generate or echo trace_id (§11). Runtime MUST mint one if absent so
    // `job.accepted.payload.trace_id` always has a value to echo back.
    const traceId = env.trace_id ?? randomBytes(16).toString("hex");

    const job = new Job(
      {
        ...(idempotencyHit !== null ? { jobId: idempotencyHit.jobId } : {}),
        sessionId,
        agent: payload.agent,
        lease: requestedLease,
        heartbeatIntervalSeconds:
          this.options.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_SECONDS,
        ...(traceId !== undefined ? { traceId } : {}),
      },
      (out) => ctx.send(out),
      ctx,
      ctx.logger.child({ job_id: "<pending>" }),
    );
    ctx.jobs.register(job);
    Object.assign(job, { logger: ctx.logger.child({ job_id: job.jobId }) });

    if (payload.idempotency_key !== undefined && idempotencyHit === null) {
      const key = `${principal}::${payload.idempotency_key}`;
      const ttl = this.options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
      this.idempotencyStore.set(key, {
        jobId: job.jobId,
        agent: payload.agent,
        inputDigest: digest(payload.input),
        expiresAt: Date.now() + ttl,
      });
    }

    await job.emitAccepted();
    await job.emitRunning();

    const jobCtx = makeJobContext(job);
    void this.runHandler(
      ctx,
      job,
      handler,
      payload.input,
      jobCtx,
      payload.max_runtime_sec,
    );
  }

  private async runHandler(
    ctx: SessionContext,
    job: Job,
    handler: AgentHandler,
    input: unknown,
    jobCtx: JobContext,
    maxRuntimeSec: number | undefined,
  ): Promise<void> {
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    if (maxRuntimeSec !== undefined && maxRuntimeSec > 0) {
      timeoutTimer = setTimeout(() => {
        if (!job.isTerminal) {
          job.abortController.abort(
            new InternalError("max_runtime_sec exceeded"),
          );
          void job.emitErrorEnvelope({
            final_status: "timed_out",
            code: "TIMEOUT",
            message: `Job exceeded max_runtime_sec=${maxRuntimeSec}`,
            retryable: true,
          });
        }
      }, maxRuntimeSec * 1000);
      timeoutTimer.unref();
    }
    // Listen for delegate events on this job context — runtime intercepts them.
    const delegateInterceptor = makeDelegateInterceptor(this, ctx, job);
    const wrapped = wrapJobCtx(jobCtx, delegateInterceptor);

    try {
      const result = await handler(input, wrapped);
      if (!job.isTerminal) {
        await job.emitResult({
          final_status: "success",
          result,
        });
      }
    } catch (err) {
      if (job.isTerminal) return;
      const wrappedErr =
        err instanceof ARCPError
          ? err
          : err instanceof Error && err.name === "CancelledError"
            ? new CancelledError(err.message)
            : new InternalError(
                err instanceof Error ? err.message : String(err),
                {
                  cause: err instanceof Error ? err : undefined,
                },
              );
      const finalStatus =
        wrappedErr instanceof CancelledError
          ? "cancelled"
          : wrappedErr.code === "TIMEOUT"
            ? "timed_out"
            : "error";
      await job.emitErrorEnvelope({
        final_status: finalStatus,
        code: wrappedErr.code,
        message: wrappedErr.message,
        retryable: wrappedErr.retryable,
      });
    } finally {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      ctx.jobs.retire(job.jobId);
    }
  }

  private async handleJobCancel(
    ctx: SessionContext,
    env: Envelope,
  ): Promise<void> {
    if (env.type !== "job.cancel") return;
    const jobId = env.job_id;
    if (jobId === undefined) {
      await ctx.emitSessionError(
        new InvalidRequestError("job.cancel requires job_id"),
      );
      return;
    }
    const job = ctx.jobs.get(jobId);
    if (job === undefined) {
      await ctx.emitJobError(jobId, {
        final_status: "error",
        code: "JOB_NOT_FOUND",
        message: `Job "${jobId}" not found in this session`,
        retryable: false,
      });
      return;
    }
    if (job.isTerminal) return;
    const reason = env.payload.reason ?? "client_cancel";
    job.cancel(reason);
    // Grace period (§7.4): default 30s; force-emit cancelled error on expiry.
    const graceMs = this.options.cancelGraceMs ?? DEFAULT_GRACE_MS;
    const timer = setTimeout(() => {
      if (!job.isTerminal) {
        void job.emitErrorEnvelope({
          final_status: "cancelled",
          code: "CANCELLED",
          message: `Cancellation grace expired (${graceMs}ms)`,
          retryable: false,
        });
      }
    }, graceMs);
    timer.unref();
  }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------

  private async authenticate(
    auth: SessionHelloPayload["auth"],
  ): Promise<BearerIdentity> {
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
      `Auth scheme "${auth.scheme}" not supported in v1.0`,
    );
  }

  // ---------------------------------------------------------------------
  // Internal sweeps
  // ---------------------------------------------------------------------

  private sweepIdempotency(): void {
    const now = Date.now();
    for (const [k, v] of this.idempotencyStore.entries()) {
      if (v.expiresAt <= now) this.idempotencyStore.delete(k);
    }
  }

  private sweepResume(): void {
    const now = Date.now();
    for (const [k, v] of this.resumeStore.entries()) {
      if (v.expiresAt <= now) this.resumeStore.delete(k);
    }
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

  // ---------------------------------------------------------------------
  // §10 Delegation helpers (called via interceptor on JobContext.delegate)
  // ---------------------------------------------------------------------

  public async createDelegateJob(
    ctx: SessionContext,
    parent: Job,
    body: DelegateBody,
  ): Promise<{ ok: true; jobId: string } | { ok: false; error: ARCPError }> {
    const handler = this.agents.get(body.agent);
    if (handler === undefined) {
      return {
        ok: false,
        error: new AgentNotAvailableError(
          `Agent "${body.agent}" is not registered`,
        ),
      };
    }
    const requested: Lease = body.lease_request ?? {};
    try {
      validateLeaseShape(requested);
      assertLeaseSubset(requested, parent.lease);
    } catch (err) {
      const wrapped =
        err instanceof LeaseSubsetViolationError
          ? err
          : err instanceof ARCPError
            ? err
            : new InvalidRequestError(String(err));
      return { ok: false, error: wrapped };
    }
    const sessionId = ctx.state.id;
    if (sessionId === undefined) {
      return { ok: false, error: new InternalError("session has no id") };
    }
    const child = new Job(
      {
        sessionId,
        agent: body.agent,
        lease: requested,
        parentJobId: parent.jobId,
        delegateId: body.delegate_id,
        heartbeatIntervalSeconds:
          this.options.heartbeatIntervalSeconds ?? DEFAULT_HEARTBEAT_SECONDS,
        ...(parent.traceId !== undefined ? { traceId: parent.traceId } : {}),
      },
      (out) => ctx.send(out),
      ctx,
      ctx.logger.child({ job_id: "<pending>", parent_job_id: parent.jobId }),
    );
    ctx.jobs.register(child);
    Object.assign(child, { logger: ctx.logger.child({ job_id: child.jobId }) });
    await child.emitAccepted();
    await child.emitRunning();
    const childCtx = makeJobContext(child);
    void this.runHandler(ctx, child, handler, body.input, childCtx, undefined);
    return { ok: true, jobId: child.jobId };
  }
}

// ---------------------------------------------------------------------
// Delegation interception
// ---------------------------------------------------------------------

type DelegateInterceptor = (body: DelegateBody) => Promise<void>;

function makeDelegateInterceptor(
  server: ARCPServer,
  ctx: SessionContext,
  parent: Job,
): DelegateInterceptor {
  return async (body: DelegateBody) => {
    // Emit the delegate event on the parent job first (§10.1).
    await parent.emitEventKind("delegate", body);
    const outcome = await server.createDelegateJob(ctx, parent, body);
    if (!outcome.ok) {
      // §10.2: report failure via tool_result on PARENT job.
      await parent.emitEventKind("tool_result", {
        call_id: body.delegate_id,
        error: outcome.error.toPayload(),
      });
    }
  };
}

function wrapJobCtx(
  ctx: JobContext,
  interceptor: DelegateInterceptor,
): JobContext {
  return {
    ...ctx,
    async delegate(body: DelegateBody) {
      await interceptor(body);
    },
  };
}
