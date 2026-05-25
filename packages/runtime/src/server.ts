import type { JobId } from "@agentruntimecontrolprotocol/core";
import type { BearerIdentity } from "@agentruntimecontrolprotocol/core/auth";
import { buildEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import {
  ARCPError,
  InvalidRequestError,
  ResumeWindowExpiredError,
  UnauthenticatedError,
} from "@agentruntimecontrolprotocol/core/errors";
import {
  type Logger,
  sessionLogger as makeSessionLogger,
  rootLogger,
} from "@agentruntimecontrolprotocol/core/logger";
import type {
  AgentInventoryEntry,
  Capabilities,
  Envelope,
  SessionHelloPayload,
  SessionWelcomePayload,
} from "@agentruntimecontrolprotocol/core/messages";
import { negotiateCapabilities } from "@agentruntimecontrolprotocol/core/state";
import { EventLog } from "@agentruntimecontrolprotocol/core/store";
import type { Transport } from "@agentruntimecontrolprotocol/core/transport";
import { newMessageId, newSessionId } from "@agentruntimecontrolprotocol/core/util";
import { intersectFeatures, V1_1_FEATURES } from "@agentruntimecontrolprotocol/core/version";

import { AgentRegistry } from "./agent-registry.js";
import { JobRunner } from "./job-runner.js";
import type { Job } from "./job.js";
import { handleResume } from "./server-resume.js";
import { handleJobSubscribe, handleListJobs } from "./server-subscribe.js";
import {
  type SessionContext,
  SessionContext as SessionContextCtor,
} from "./session-context.js";
import { IdempotencyStore, newResumeToken, ResumeStore } from "./stores.js";
import type { AgentHandler, ARCPServerOptions } from "./types.js";

export { SessionContext } from "./session-context.js";

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

const DEFAULT_HEARTBEAT_SECONDS = 30;
const DEFAULT_RESUME_WINDOW_SECONDS = 600;
const DEFAULT_GRACE_MS = 30_000;

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
  public readonly resumeStore = new ResumeStore();
  private readonly jobRunner = new JobRunner(this);
  /** Live sessions, indexed by session_id (only those past welcome). */
  public readonly sessions = new Map<string, SessionContext>();
  /**
   * Global jobs registry for cross-session features (§6.6 listing,
   * §7.6 subscription). Indexed by job_id.
   */
  public readonly globalJobs = new Map<string, Job>();
  /** job_id → set of subscriber SessionContexts. */
  public readonly subscribers = new Map<string, Set<SessionContext>>();
  private resumeSweep: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a runtime with the supplied options.
   *
   * @param options - Runtime configuration, including transport policy
   *   and optional credential provisioning.
   * @throws {TypeError} When a provisioner is configured without a store.
   */
  public constructor(public readonly options: ARCPServerOptions) {
    // §14 — credential revocation reliability: a provisioner without a store
    // means credentials issued to crash-recovered jobs cannot be revoked.
    // Fail fast at startup rather than silently losing revocation records.
    if (
      options.credentialProvisioner !== undefined &&
      options.credentialStore === undefined
    ) {
      throw new TypeError(
        "ARCPServer: credentialStore is required when credentialProvisioner is set " +
          "(§14 — Credential revocation reliability). " +
          "Pass an InMemoryCredentialStore for tests, or a durable implementation for production.",
      );
    }
    this.eventLog = options.eventLog ?? new EventLog();
    this.logger = options.logger ?? rootLogger;
    this.resumeSweep = setInterval(() => {
      this.sweepResume();
    }, 60_000);
    this.resumeSweep.unref();
  }

  /**
   * v1.1 feature flags this runtime advertises. Defaults to every v1.1
   * feature, but filters out `provisioned_credentials` and `model.use` when
   * no `credentialProvisioner` is configured (§9.7 — feature flag gating).
   *
   * @returns The runtime's advertised feature list.
   */
  public get advertisedFeatures(): readonly string[] {
    const base = this.options.features ?? V1_1_FEATURES;
    if (this.options.credentialProvisioner !== undefined) return base;
    // Strip credential-related feature flags — they MUST NOT be advertised
    // when no provisioner is configured.
    return base.filter(
      (f) => f !== "provisioned_credentials" && f !== "model.use",
    );
  }

  /**
   * Register an unversioned agent handler. Submissions with a bare `agent`
   * name match this. If a versioned handler is also registered, bare-name
   * submissions resolve to the default version (or the unversioned handler
   * if no default is set).
   *
   * @param name - Agent name to register.
   * @param handler - Handler invoked for matching submissions. Receives the
   *   submitted `input` and a {@link JobContext}; throwing rejects the job
   *   with the wrapped {@link ARCPError}.
   *
   * @example
   * ```ts
   * server.registerAgent("echo", async (input, ctx) => {
   *   await ctx.status("running")
   *   return { echoed: input }
   * })
   * ```
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
   *
   * @param name - Agent name to version.
   * @param version - Version string to associate with the handler.
   * @param handler - Handler invoked for the versioned agent.
   */
  public registerAgentVersion<Input = unknown, Result = unknown>(
    name: string,
    version: string,
    handler: AgentHandler<Input, Result>,
  ): void {
    this.agentRegistry.registerVersion(name, version, handler);
  }

  /** v1.1 §7.5 — set the default version for bare-name submissions.
   *
   * @param name - Agent name to default.
   * @param version - Version string to use for bare-name submissions.
   */
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
   *
   * @param name - Agent name to resolve.
   * @param version - Optional pinned version.
   * @returns The resolved handler and version.
   */
  public resolveAgent(
    name: string,
    version: string | null,
  ): { handler: AgentHandler; version: string } {
    return this.agentRegistry.resolve(name, version);
  }

  /** Build the rich agent inventory shape (§6.2 / §7.5) for advertisement.
   *
   * @returns The current agent inventory.
   */
  public getAgentInventory(): AgentInventoryEntry[] {
    return this.agentRegistry.inventory();
  }

  /**
   * Adopt a {@link Transport} as a new session and start the v1.1 handshake.
   *
   * The returned {@link SessionContext} is fully wired (frame dispatch, close
   * handler, heartbeat scheduler) but the handshake completes asynchronously
   * — observers must use {@link SessionContext.onAccept} or its event log to
   * react to acceptance.
   *
   * @param transport - Transport to accept. The runtime takes ownership of
   *   `onFrame`/`onClose` registrations until the session terminates.
   * @returns A session context wired to the transport.
   * @throws {@link InvalidRequestError} if `maxSessions` is configured and
   *   already saturated.
   *
   * @example
   * ```ts
   * httpServer.on("upgrade", (req, sock, head) => {
   *   wss.handleUpgrade(req, sock, head, (ws) => {
   *     server.accept(new WebSocketTransport(ws))
   *   })
   * })
   * ```
   */
  public accept(transport: Transport): SessionContext {
    const ctx = new SessionContextCtor(transport, this, this.logger);
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

  /** Close the runtime and the underlying event log.
   *
   * @returns A promise that resolves when shutdown is complete.
   */
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
      await handleResume({
        server: this,
        ctx,
        identity,
        payload: env.payload,
      });
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

  public buildWelcomePayload(
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
  public makeNegotiatedCapabilities(
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

  public bindLogger(ctx: SessionContext, clientName: string): void {
    const sessionId = ctx.state.id;
    if (sessionId === undefined) return;
    ctx.logger = makeSessionLogger(this.logger, sessionId).child({
      client: clientName,
    });
  }

  public registerPostHandshakeHandlers(ctx: SessionContext): void {
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
      await handleListJobs(this, ctx, env);
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
      await handleJobSubscribe(this, ctx, env);
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
    const idle: SessionContext[] = [];
    for (const ctx of this.sessions.values()) {
      if (now - ctx.lastActivityAt > windowMs) {
        idle.push(ctx);
      }
    }
    if (idle.length === 0) return;
    void Promise.allSettled(
      idle.map(async (ctx) => {
        try {
          await ctx.emitSessionError(
            new ResumeWindowExpiredError(
              "session idle past resume_window_sec",
            ),
          );
        } finally {
          await ctx.terminate("resume window expired");
        }
      }),
    );
  }

  // §10 delegation child-job creation lives on `JobRunner` in ./job-runner.ts.
}

// Job's `submitterPrincipal` and `owningSession` fields are declared in
// `./job.ts` (Job class definition) for §6.6/§7.6 cross-session features.
