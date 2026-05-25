/* eslint-disable max-lines */
import { randomBytes } from "node:crypto";

import type { JobId, SessionId } from "@agentruntimecontrolprotocol/core";
import { type BaseEnvelope, buildEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import {
  CancelledError,
  InvalidRequestError,
  UnauthenticatedError,
} from "@agentruntimecontrolprotocol/core/errors";
import { type Logger, rootLogger } from "@agentruntimecontrolprotocol/core/logger";
import type {
  Capabilities,
  Envelope,
  JobAcceptedPayload,
  JobListEntry,
  JobResultPayload,
  JobSubscribedPayload,
  SessionJobsPayload,
  SessionListJobsFilter,
  SessionResume,
  SessionWelcomePayload,
} from "@agentruntimecontrolprotocol/core/messages";
import { PendingRegistry, SessionState } from "@agentruntimecontrolprotocol/core/state";
import type { Transport, WireFrame } from "@agentruntimecontrolprotocol/core/transport";
import { Deferred, newMessageId } from "@agentruntimecontrolprotocol/core/util";
import { intersectFeatures, V1_1_FEATURES } from "@agentruntimecontrolprotocol/core/version";

import { dispatchEnvelope } from "./client-dispatch.js";
import {
  buildByeEnvelope,
  buildHelloEnvelope,
  buildSubmitEnvelope,
  buildSubscribeEnvelope,
  buildUnsubscribeEnvelope,
} from "./client-envelopes.js";
import {
  type InvocationState,
  makeHandleFromInvocation,
} from "./client-handle.js";
import type {
  ARCPClientOptions,
  ClientHandler,
  JobHandle,
  JobSubscription,
  SubmitOptions,
} from "./types.js";

// ARCP v1.1 client (additive over v1.0).
//
// Surface:
//   - `connect(transport)`            → handshake, returns SessionWelcomePayload.
//   - `submit({ agent, input, ... })` → sends job.submit, awaits job.accepted.
//   - `cancelJob(jobId, { reason? })` → sends job.cancel.
//   - `close(reason?)`                → sends session.bye then closes transport.
//   - v1.1: `ack(seq)`, `listJobs(filter, opts)`, `subscribe(jobId, opts)`.

/**
 * Client-side driver for an ARCP v1.1 session (§6).
 *
 * One client instance owns one transport and one session. After
 * {@link ARCPClient.connect} resolves, the session is ready for job
 * submission and observation. Use {@link ARCPClient.resume} to recover a
 * prior session within the runtime's resume window.
 */
export class ARCPClient {
  public readonly state = new SessionState();
  public readonly pending = new PendingRegistry();
  public readonly logger: Logger;
  private readonly handlers = new Map<string, ClientHandler>();
  private transport: Transport | null = null;
  private handshake: Deferred<SessionWelcomePayload> | null = null;
  private readonly handshakeTimeoutMs: number;
  /** Latest `event_seq` observed for this session. Used on resume. */
  private lastEventSeq = 0;
  /** Most recent welcome payload (carries the fresh `resume_token`). */
  private welcome: SessionWelcomePayload | null = null;
  /** In-flight submissions keyed by the originating envelope id (submit). */
  private readonly invocationsByOriginId = new Map<string, InvocationState>();
  /** Map job_id → invocation once `job.accepted` is received. */
  private readonly invocationsByJobId = new Map<string, InvocationState>();
  /** FIFO of in-flight submissions awaiting job.accepted (ordered binding). */
  private readonly pendingAccepts: InvocationState[] = [];
  /** v1.1 §6.2 — negotiated feature set (intersection with runtime). */
  private _negotiatedFeatures: readonly string[] = [];
  /** v1.1 §6.6 — pending list_jobs requests keyed by envelope id. */
  private readonly pendingLists = new Map<
    string,
    Deferred<SessionJobsPayload>
  >();
  /** v1.1 §7.6 — pending subscribe requests keyed by job_id. */
  private readonly pendingSubscribes = new Map<
    string,
    Deferred<JobSubscribedPayload>
  >();
  /** v1.1 §6.5 — auto-ack scheduler state. */
  private readonly autoAckOpts: {
    intervalMs: number;
    minSeqDelta: number;
  } | null = null;
  private autoAckTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAckedSeq = 0;

  public constructor(public readonly options: ARCPClientOptions) {
    this.logger =
      options.logger ?? rootLogger.child({ component: "arcp-client" });
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5000;
    if (options.autoAck !== undefined && options.autoAck !== false) {
      const o = options.autoAck === true ? {} : options.autoAck;
      this.autoAckOpts = {
        intervalMs: o.intervalMs ?? 250,
        minSeqDelta: o.minSeqDelta ?? 32,
      };
    }
  }

  public get lastEventSeqObserved(): number {
    return this.lastEventSeq;
  }

  public get welcomePayload(): SessionWelcomePayload | null {
    return this.welcome;
  }

  /** v1.1 — features negotiated with the runtime (intersection). */
  public get negotiatedFeatures(): readonly string[] {
    return this._negotiatedFeatures;
  }

  /** v1.1 — check whether a feature is in the negotiated set. */
  public hasFeature(name: string): boolean {
    return this._negotiatedFeatures.includes(name);
  }

  /**
   * Connect over `transport` and complete the v1.1 handshake.
   *
   * Sends `session.hello`, awaits `session.welcome`, and records the
   * negotiated capabilities (encodings, features, agent inventory). Use
   * {@link ARCPClient.resume} instead to recover an existing session.
   *
   * @param transport - Transport to bind to this client. The client takes
   *   ownership of `onFrame`/`onClose` registrations for its lifetime.
   * @param opts.signal - Optional abort signal for the handshake. If
   *   already aborted, this throws `signal.reason` before sending hello.
   * @returns The negotiated `session.welcome` payload.
   * @throws {@link InvalidRequestError} if the client is already connected
   *   or the transport closes before the handshake completes.
   * @throws {@link ARCPError} on runtime rejection or malformed envelopes.
   *
   * @example
   * ```ts
   * const client = new ARCPClient({ identity: { name: "demo", version: "1.0.0" } })
   * const welcome = await client.connect(transport)
   * console.log("session id:", welcome.session_id)
   * ```
   */
  public async connect(
    transport: Transport,
    opts: { signal?: AbortSignal } = {},
  ): Promise<SessionWelcomePayload> {
    opts.signal?.throwIfAborted();
    return this.connectInternal(transport, undefined, opts.signal);
  }

  /**
   * Resume a prior session under the same principal. Sends a hello with the
   * resume block and replays missed events upon welcome.
   *
   * The runtime replays any events with `event_seq > resume.lastEventSeq`
   * before the welcome resolves. Use {@link ARCPClient.connect} for fresh
   * sessions.
   *
   * @param transport - Fresh transport for the resumed session.
   * @param resume - Resume tuple identifying the prior session.
   * @param opts.signal - Optional abort signal for the handshake.
   * @returns The negotiated `session.welcome` payload.
   * @throws {@link ResumeWindowExpiredError} when the prior session is
   *   beyond the runtime's resume window.
   * @throws {@link ARCPError} when the runtime rejects the resume request.
   *
   * @example
   * ```ts
   * const welcome = await client.resume(transport, {
   *   sessionId: previous.sessionId,
   *   lastEventSeq: previous.eventSeq,
   * })
   * ```
   */
  public async resume(
    transport: Transport,
    resume: SessionResume,
    opts: { signal?: AbortSignal } = {},
  ): Promise<SessionWelcomePayload> {
    opts.signal?.throwIfAborted();
    return this.connectInternal(transport, resume, opts.signal);
  }

  private async connectInternal(
    transport: Transport,
    resume: SessionResume | undefined,
    signal?: AbortSignal,
  ): Promise<SessionWelcomePayload> {
    if (this.transport !== null) {
      throw new InvalidRequestError("ARCPClient is already connected");
    }
    this.transport = transport;
    this.handshake = new Deferred<SessionWelcomePayload>();
    this.wireTransport(transport);
    const advertisedFeatures = this.options.features ?? V1_1_FEATURES;
    const baseCaps = this.buildAdvertisedCapabilities(advertisedFeatures);
    await transport.send(this.buildHelloEnvelope(baseCaps, resume));
    return this.awaitHandshake(advertisedFeatures, signal);
  }

  private wireTransport(transport: Transport): void {
    transport.onFrame((frame) => this.dispatchRaw(frame));
    transport.onClose((err) => {
      if (this.handshake !== null && !this.handshake.settled) {
        this.handshake.reject(
          new InvalidRequestError(
            "Transport closed before handshake completed",
            { cause: err },
          ),
        );
      }
    });
  }

  private buildAdvertisedCapabilities(
    advertisedFeatures: readonly string[],
  ): Capabilities {
    // v1.1 §6.2 — advertise features. If the consumer didn't supply a
    // `capabilities` block, build one with our default features. If they
    // did, augment with `features` (unless they explicitly set it).
    const baseCaps: Capabilities = { ...this.options.capabilities };
    if (baseCaps.features === undefined && advertisedFeatures.length > 0) {
      baseCaps.features = [...advertisedFeatures];
    }
    baseCaps.encodings ??= ["json"];
    return baseCaps;
  }

  private buildHelloEnvelope(
    baseCaps: Capabilities,
    resume: SessionResume | undefined,
  ): BaseEnvelope {
    return buildHelloEnvelope({
      id: newMessageId(),
      options: this.options,
      capabilities: baseCaps,
      resume,
    });
  }

  private async awaitHandshake(
    advertisedFeatures: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<SessionWelcomePayload> {
    const timeout = setTimeout(() => {
      if (this.handshake !== null && !this.handshake.settled) {
        this.handshake.reject(new InvalidRequestError("Handshake timed out"));
      }
    }, this.handshakeTimeoutMs);
    timeout.unref();
    const onAbort = (): void => {
      this.rejectHandshakeForAbort(signal);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const handshake = this.handshake;
    if (handshake === null) {
      throw new InvalidRequestError("Handshake state was cleared");
    }
    try {
      const welcome = await handshake.promise;
      this.welcome = welcome;
      this.state.assignCapabilities(welcome.capabilities);
      this.state.transition("accepted");
      this._negotiatedFeatures = intersectFeatures(
        advertisedFeatures,
        welcome.capabilities.features,
      );
      return welcome;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private rejectHandshakeForAbort(signal: AbortSignal | undefined): void {
    if (this.handshake === null || this.handshake.settled) return;
    const reason: unknown = signal?.reason;
    this.handshake.reject(
      new CancelledError("Handshake aborted by caller", {
        cause: reason instanceof Error ? reason : undefined,
      }),
    );
  }

  /** Register a handler for a specific message type.
   *
   * @param type - Envelope type name to observe.
   * @param handler - Async callback invoked for matching envelopes.
   */
  public on(type: string, handler: ClientHandler): void {
    this.handlers.set(type, handler);
  }

  /** Send an envelope to the runtime. Requires an accepted session.
   *
   * @param env - Envelope to transmit.
   * @param opts - Optional abort signal.
   * @throws {@link InvalidRequestError} if the client is disconnected.
   * @throws {@link UnauthenticatedError} if the session is not accepted.
   */
  public async send(
    env: BaseEnvelope,
    opts: { signal?: AbortSignal } = {},
  ): Promise<void> {
    opts.signal?.throwIfAborted();
    if (this.transport === null)
      throw new InvalidRequestError("Client not connected");
    if (!this.state.isAccepted) {
      throw new UnauthenticatedError("Cannot send: session not accepted");
    }
    await this.transport.send(env);
  }

  /** Close the underlying transport, optionally sending session.bye.
   *
   * @param reason - Optional close reason forwarded to the transport.
   */
  public async close(reason?: string): Promise<void> {
    this.rejectAllPending(new CancelledError("Client closing"));
    this.clearAutoAckTimer();
    if (this.transport === null) return;
    await this.sendBye(reason);
    await this.transport.close(reason);
    this.transport = null;
  }

  private rejectAllPending(error: CancelledError): void {
    this.pending.rejectAll(error);
    for (const inv of this.invocationsByOriginId.values()) {
      inv.acceptance.reject(error);
      inv.completion.reject(error);
    }
    this.invocationsByOriginId.clear();
    this.invocationsByJobId.clear();
    this.pendingAccepts.length = 0;
    for (const d of this.pendingLists.values()) d.reject(error);
    this.pendingLists.clear();
    for (const d of this.pendingSubscribes.values()) d.reject(error);
    this.pendingSubscribes.clear();
  }

  private clearAutoAckTimer(): void {
    if (this.autoAckTimer === null) return;
    clearTimeout(this.autoAckTimer);
    this.autoAckTimer = null;
  }

  private async sendBye(reason: string | undefined): Promise<void> {
    if (this.transport === null) return;
    const sessionId = this.state.id;
    if (sessionId === undefined || !this.state.isAccepted) return;
    try {
      await this.transport.send(buildByeEnvelope(sessionId, reason));
    } catch {
      // best-effort
    }
  }

  /**
   * Submit a job. Returns once `job.accepted` arrives, with a handle whose
   * `done` resolves on the terminal `job.result` and rejects on `job.error`.
   *
   * Pre-aborted `opts.signal` rejects with {@link CancelledError} before the
   * submit envelope is sent. Aborting after submit but before acceptance
   * removes the pending invocation and rejects `handle.done`; aborting after
   * acceptance issues a `job.cancel` for the assigned `jobId`.
   *
   * @param opts - Submission payload (agent, input, lease, etc.) and
   *   optional control flags (`signal`, `traceId`).
   * @returns A handle for the accepted job.
   * @throws {@link InvalidRequestError} if the client is disconnected.
   * @throws {@link UnauthenticatedError} if the session is not accepted.
   * @throws {@link CancelledError} if `opts.signal` is already aborted.
   *
   * @example
   * ```ts
   * const handle = await client.submit({ agent: "research", input: { q } })
   * const result = await handle.done
   * ```
   */
  public async submit(opts: SubmitOptions): Promise<JobHandle> {
    if (this.transport === null) {
      throw new InvalidRequestError("Client not connected");
    }
    if (!this.state.isAccepted) {
      throw new UnauthenticatedError("Cannot submit: session not accepted");
    }
    const sessionId = this.state.id;
    if (sessionId === undefined) {
      throw new InvalidRequestError("session has no id");
    }
    // Pre-aborted signal: never register the invocation or send anything.
    // Returning a dead handle would leave callers awaiting `handle.done`
    // forever; the explicit throw matches `cancelJob`'s contract.
    if (opts.signal?.aborted === true) {
      throw new CancelledError(
        typeof opts.signal.reason === "string"
          ? opts.signal.reason
          : "aborted before submit",
      );
    }
    const id = newMessageId();
    const env = buildSubmitEnvelope({ id, sessionId, opts });
    const invocation = this.registerSubmitInvocation(id, opts);
    const detachAbort = this.wireSubmitAbort(invocation, id, opts.signal);
    try {
      await this.transport.send(env);
      // The routeJobEvent path resolves `acceptance` *and* registers the
      // invocation in `invocationsByJobId` before this await returns, so any
      // subsequent events arriving in the same tick will still route.
      await invocation.acceptance.promise;
    } catch (error) {
      this.invocationsByOriginId.delete(id);
      removeFromArray(this.pendingAccepts, invocation);
      invocation.completion.reject(error);
      detachAbort();
      throw error;
    }
    detachAbort();
    return makeHandleFromInvocation(invocation);
  }

  private registerSubmitInvocation(
    id: string,
    opts: SubmitOptions,
  ): InvocationState {
    const invocation: InvocationState = {
      jobId: null,
      lease: null,
      agent: undefined,
      leaseConstraints: undefined,
      budget: undefined,
      credentials: undefined,
      traceId: opts.traceId,
      events: [],
      acceptance: new Deferred<JobAcceptedPayload>(),
      completion: new Deferred<JobResultPayload>(),
      chunks: new Map(),
    };
    // Mute unhandled-rejection on `completion` — callers consume it via
    // `handle.done`. If the submit rejects pre-handle (e.g.
    // AGENT_NOT_AVAILABLE before any `job.accepted`), this prevents a
    // spurious unhandled promise rejection.
    invocation.completion.promise.catch(() => undefined);
    this.invocationsByOriginId.set(id, invocation);
    this.pendingAccepts.push(invocation);
    return invocation;
  }

  private wireSubmitAbort(
    invocation: InvocationState,
    originId: string,
    signal: AbortSignal | undefined,
  ): () => void {
    if (signal === undefined) return () => undefined;
    const onAbort = (): void => {
      if (invocation.jobId !== null) {
        void this.cancelJob(invocation.jobId, {
          reason: String(signal.reason ?? "abort"),
        });
        return;
      }
      // Abort raced in before `job.accepted` — drop the pending invocation so
      // it does not pile up in `invocationsByOriginId` or `pendingAccepts`,
      // and surface the failure on both deferreds.
      this.invocationsByOriginId.delete(originId);
      removeFromArray(this.pendingAccepts, invocation);
      const reason = new CancelledError(
        typeof signal.reason === "string"
          ? signal.reason
          : "aborted before acceptance",
      );
      invocation.acceptance.reject(reason);
      invocation.completion.reject(reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => {
      signal.removeEventListener("abort", onAbort);
    };
  }

  /** Send a `job.cancel` envelope.
   *
   * @param jobId - Job to cancel.
   * @param options - Optional cancellation reason and abort signal.
   */
  public async cancelJob(
    jobId: JobId,
    options: { reason?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    options.signal?.throwIfAborted();
    if (this.transport === null)
      throw new InvalidRequestError("Client not connected");
    const sessionId = this.state.id;
    if (sessionId === undefined)
      throw new InvalidRequestError("session has no id");
    const env = buildEnvelope({
      id: newMessageId(),
      type: "job.cancel" as const,
      payload: options.reason === undefined ? {} : { reason: options.reason },
      optional: { session_id: sessionId, job_id: jobId },
    });
    await this.transport.send(env);
  }

  /**
   * v1.1 §6.5 — manually acknowledge that events with `event_seq ≤ seq` have
   * been processed. The runtime MAY free buffered events earlier than the
   * resume window. This is purely advisory and does not affect resume
   * semantics.
   *
   * @param seq - Highest processed event sequence.
   * @param opts - Optional abort signal.
   * @throws {@link InvalidRequestError} if the `ack` feature was not negotiated.
   */
  public async ack(
    seq: number,
    opts: { signal?: AbortSignal } = {},
  ): Promise<void> {
    opts.signal?.throwIfAborted();
    if (!this.hasFeature("ack")) {
      throw new InvalidRequestError(
        "session.ack requires the 'ack' feature to be negotiated",
      );
    }
    if (this.transport === null)
      throw new InvalidRequestError("Client not connected");
    const sessionId = this.state.id;
    if (sessionId === undefined)
      throw new InvalidRequestError("session has no id");
    const env = buildEnvelope({
      id: newMessageId(),
      type: "session.ack" as const,
      payload: { last_processed_seq: seq },
      optional: { session_id: sessionId },
    });
    await this.transport.send(env);
    if (seq > this.lastAckedSeq) this.lastAckedSeq = seq;
  }

  /**
   * v1.1 §6.6 — request a read-only inventory of jobs accessible in this
   * session. Returns a single page; pass `cursor: result.nextCursor` to
   * fetch additional pages.
   *
   * @param filter - Optional server-side filter.
   * @param opts - Paging options and abort signal.
   * @returns A single page of jobs and the next cursor, if any.
   * @throws {@link InvalidRequestError} if `list_jobs` was not negotiated.
   */
  public async listJobs(
    filter?: SessionListJobsFilter,
    opts: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<{ jobs: JobListEntry[]; nextCursor: string | null }> {
    opts.signal?.throwIfAborted();
    if (!this.hasFeature("list_jobs")) {
      throw new InvalidRequestError(
        "session.list_jobs requires the 'list_jobs' feature to be negotiated",
      );
    }
    if (this.transport === null)
      throw new InvalidRequestError("Client not connected");
    const sessionId = this.state.id;
    if (sessionId === undefined)
      throw new InvalidRequestError("session has no id");
    const id = newMessageId();
    const deferred = new Deferred<SessionJobsPayload>();
    this.pendingLists.set(id, deferred);
    const env = buildEnvelope({
      id,
      type: "session.list_jobs" as const,
      payload: {
        ...(filter === undefined ? {} : { filter }),
        ...(opts.limit === undefined ? {} : { limit: opts.limit }),
        ...(opts.cursor === undefined ? {} : { cursor: opts.cursor }),
      },
      optional: { session_id: sessionId },
    });
    await this.transport.send(env);
    const resp = await deferred.promise;
    return { jobs: resp.jobs, nextCursor: resp.next_cursor };
  }

  /**
   * v1.1 §7.6 — subscribe to a job by id, optionally replaying buffered
   * history. The returned {@link JobSubscription} exposes `unsubscribe()`;
   * events for the subscribed job arrive via the usual handlers
   * (`client.on("job.event", ...)`) as they would for any in-session job.
   *
   * @param jobId - Job to observe.
   * @param opts - History and sequence options.
   * @returns A job subscription handle.
   * @throws {@link InvalidRequestError} if `subscribe` was not negotiated.
   */
  public async subscribe(
    jobId: JobId,
    opts: {
      history?: boolean;
      fromEventSeq?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<JobSubscription> {
    opts.signal?.throwIfAborted();
    if (!this.hasFeature("subscribe")) {
      throw new InvalidRequestError(
        "job.subscribe requires the 'subscribe' feature to be negotiated",
      );
    }
    if (this.transport === null) {
      throw new InvalidRequestError("Client not connected");
    }
    const sessionId = this.state.id;
    if (sessionId === undefined) {
      throw new InvalidRequestError("session has no id");
    }
    const deferred = new Deferred<JobSubscribedPayload>();
    this.pendingSubscribes.set(jobId, deferred);
    await this.transport.send(buildSubscribeEnvelope(jobId, sessionId, opts));
    const ack = await deferred.promise;
    return {
      jobId,
      subscribedFrom: ack.subscribed_from,
      replayed: ack.replayed,
      unsubscribe: () => this.unsubscribe(jobId, sessionId),
    };
  }

  private async unsubscribe(jobId: JobId, sessionId: SessionId): Promise<void> {
    if (this.transport === null) return;
    try {
      await this.transport.send(buildUnsubscribeEnvelope(jobId, sessionId));
    } catch {
      // best-effort
    }
  }

  // -------------------------------------------------------------------

  private async dispatchRaw(frame: WireFrame): Promise<void> {
    await dispatchEnvelope(
      {
        logger: this.logger,
        state: this.state,
        handshake: this.handshake,
        invocationsByOriginId: this.invocationsByOriginId,
        invocationsByJobId: this.invocationsByJobId,
        pendingAccepts: this.pendingAccepts,
        pendingLists: this.pendingLists,
        pendingSubscribes: this.pendingSubscribes,
        handlers: this.handlers as Map<
          string,
          (env: Envelope) => Promise<void>
        >,
        transport: this.transport,
        observeEventSeq: (env) => {
          if (
            env.event_seq !== undefined &&
            env.event_seq > this.lastEventSeq
          ) {
            this.lastEventSeq = env.event_seq;
            this.scheduleAutoAck();
          }
        },
      },
      frame,
    );
  }

  private scheduleAutoAck(): void {
    if (this.autoAckOpts === null) return;
    if (!this.hasFeature("ack")) return;
    const { intervalMs, minSeqDelta } = this.autoAckOpts;
    const delta = this.lastEventSeq - this.lastAckedSeq;
    if (delta >= minSeqDelta) {
      // Fire immediately (still async-safe).
      void this.flushAutoAck().catch(() => undefined);
      return;
    }
    if (this.autoAckTimer !== null) return;
    this.autoAckTimer = setTimeout(() => {
      this.autoAckTimer = null;
      void this.flushAutoAck().catch(() => undefined);
    }, intervalMs);
    this.autoAckTimer.unref();
  }

  private async flushAutoAck(): Promise<void> {
    if (this.lastEventSeq <= this.lastAckedSeq) return;
    if (!this.hasFeature("ack")) return;
    try {
      await this.ack(this.lastEventSeq);
    } catch {
      // best-effort
    }
  }
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

function removeFromArray<T>(arr: T[], value: T): void {
  const idx = arr.indexOf(value);
  if (idx !== -1) arr.splice(idx, 1);
}

// Silence unused — re-exported for future timers.
void randomBytes;
