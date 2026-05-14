import { randomBytes } from "node:crypto";

import type { JobId, TraceId } from "@arcp/core";
import {
  type BaseEnvelope,
  buildEnvelope,
  RoundTripEnvelopeSchema,
} from "@arcp/core/envelope";
import {
  ARCPError,
  CancelledError,
  InvalidRequestError,
  UnauthenticatedError,
} from "@arcp/core/errors";
import { type Logger, rootLogger } from "@arcp/core/logger";
import {
  type Capabilities,
  type Envelope,
  EnvelopeSchema,
  type JobAcceptedPayload,
  type JobEventPayload,
  type JobListEntry,
  type JobResultPayload,
  type JobSubscribedPayload,
  jobErrorToErrorPayload,
  type Lease,
  type LeaseConstraints,
  type ResultChunkBody,
  type SessionJobsPayload,
  type SessionListJobsFilter,
  type SessionResume,
  type SessionWelcomePayload,
} from "@arcp/core/messages";
import { PendingRegistry, SessionState } from "@arcp/core/state";
import type { Transport, WireFrame } from "@arcp/core/transport";
import { Deferred, newMessageId } from "@arcp/core/util";
import { intersectFeatures, V1_1_FEATURES } from "@arcp/core/version";

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

interface InvocationState {
  jobId: JobId | null;
  lease: Lease | null;
  agent: string | undefined;
  leaseConstraints: LeaseConstraints | undefined;
  budget: Record<string, number> | undefined;
  traceId: TraceId | undefined;
  events: JobEventPayload[];
  acceptance: Deferred<JobAcceptedPayload>;
  completion: Deferred<JobResultPayload>;
  /** v1.1 §8.4 — accumulated result chunks, keyed by result_id. */
  chunks: Map<string, ResultChunkBody[]>;
}

/**
 * Client-side driver for an ARCP v1.1 session (§6).
 *
 * One client instance owns one transport and one session. After
 * {@link ARCPClient.connect} resolves, the session is in the `accepted`
 * phase and {@link ARCPClient.submit} may be called to launch jobs.
 * Use {@link ARCPClient.resume} to recover a prior session within the
 * runtime's resume window.
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
   * Connect over `transport` and complete the handshake.
   *
   * Resolves with the negotiated `session.welcome` payload; rejects with
   * an {@link ARCPError} on rejection, malformed envelopes, or timeout.
   */
  public async connect(transport: Transport): Promise<SessionWelcomePayload> {
    return this.connectInternal(transport, undefined);
  }

  /**
   * Resume a prior session under the same principal. Sends a hello with the
   * resume block and replays missed events upon welcome.
   */
  public async resume(
    transport: Transport,
    resume: SessionResume,
  ): Promise<SessionWelcomePayload> {
    return this.connectInternal(transport, resume);
  }

  private async connectInternal(
    transport: Transport,
    resume: SessionResume | undefined,
  ): Promise<SessionWelcomePayload> {
    if (this.transport !== null) {
      throw new InvalidRequestError("ARCPClient is already connected");
    }
    this.transport = transport;
    this.handshake = new Deferred<SessionWelcomePayload>();

    transport.onFrame((frame) => this.dispatchRaw(frame));
    transport.onClose((err) => {
      if (this.handshake !== null && !this.handshake.settled) {
        this.handshake.reject(
          new InvalidRequestError(
            "Transport closed before handshake completed",
            {
              cause: err,
            },
          ),
        );
      }
    });

    // v1.1 §6.2 — advertise features. If the consumer didn't supply a
    // `capabilities` block, build one with our default features. If they
    // did, augment with `features` (unless they explicitly set it).
    const advertisedFeatures = this.options.features ?? V1_1_FEATURES;
    const baseCaps: Capabilities = { ...this.options.capabilities };
    if (baseCaps.features === undefined && advertisedFeatures.length > 0) {
      baseCaps.features = [...advertisedFeatures];
    }
    baseCaps.encodings ??= ["json"];

    const helloId = newMessageId();
    const helloEnv = buildEnvelope({
      id: helloId,
      type: "session.hello" as const,
      payload: {
        client: this.options.client,
        auth: {
          scheme: this.options.authScheme,
          ...(this.options.token === undefined
            ? {}
            : { token: this.options.token }),
        },
        capabilities: baseCaps,
        ...(resume === undefined ? {} : { resume }),
      },
    });
    await transport.send(helloEnv);

    const timeout = setTimeout(() => {
      if (this.handshake !== null && !this.handshake.settled) {
        this.handshake.reject(new InvalidRequestError("Handshake timed out"));
      }
    }, this.handshakeTimeoutMs);
    timeout.unref();
    try {
      const welcome = await this.handshake.promise;
      this.welcome = welcome;
      this.state.assignCapabilities(welcome.capabilities);
      this.state.transition("accepted");
      // v1.1 — store the negotiated feature set (intersection).
      this._negotiatedFeatures = intersectFeatures(
        advertisedFeatures,
        welcome.capabilities.features,
      );
      return welcome;
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
    if (this.transport === null)
      throw new InvalidRequestError("Client not connected");
    if (!this.state.isAccepted) {
      throw new UnauthenticatedError("Cannot send: session not accepted");
    }
    await this.transport.send(env);
  }

  /** Close the underlying transport, optionally sending session.bye. */
  public async close(reason?: string): Promise<void> {
    this.pending.rejectAll(new CancelledError("Client closing"));
    for (const inv of this.invocationsByOriginId.values()) {
      inv.acceptance.reject(new CancelledError("Client closing"));
      inv.completion.reject(new CancelledError("Client closing"));
    }
    this.invocationsByOriginId.clear();
    this.invocationsByJobId.clear();
    this.pendingAccepts.length = 0;
    for (const d of this.pendingLists.values()) {
      d.reject(new CancelledError("Client closing"));
    }
    this.pendingLists.clear();
    for (const d of this.pendingSubscribes.values()) {
      d.reject(new CancelledError("Client closing"));
    }
    this.pendingSubscribes.clear();
    if (this.autoAckTimer !== null) {
      clearTimeout(this.autoAckTimer);
      this.autoAckTimer = null;
    }
    if (this.transport === null) return;
    const sessionId = this.state.id;
    if (sessionId !== undefined && this.state.isAccepted) {
      try {
        const env = buildEnvelope({
          id: newMessageId(),
          type: "session.bye" as const,
          payload: reason === undefined ? {} : { reason },
          optional: { session_id: sessionId },
        });
        await this.transport.send(env);
      } catch {
        // best-effort
      }
    }
    await this.transport.close(reason);
    this.transport = null;
  }

  /**
   * Submit a job. Returns once `job.accepted` arrives, with a handle that
   * exposes `done` for the terminal `job.result` / `job.error`.
   */
  public async submit(opts: SubmitOptions): Promise<JobHandle> {
    if (this.transport === null)
      throw new InvalidRequestError("Client not connected");
    if (!this.state.isAccepted) {
      throw new UnauthenticatedError("Cannot submit: session not accepted");
    }
    const sessionId = this.state.id;
    if (sessionId === undefined)
      throw new InvalidRequestError("session has no id");

    const id = newMessageId();
    const env = buildEnvelope({
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

    const invocation: InvocationState = {
      jobId: null,
      lease: null,
      agent: undefined,
      leaseConstraints: undefined,
      budget: undefined,
      traceId: opts.traceId,
      events: [],
      acceptance: new Deferred<JobAcceptedPayload>(),
      completion: new Deferred<JobResultPayload>(),
      chunks: new Map(),
    };
    // Mute unhandled-rejection on `completion` — callers consume it via
    // `handle.done`. If the submit rejects pre-handle (e.g. AGENT_NOT_AVAILABLE
    // arriving before any `job.accepted`), this prevents a spurious unhandled
    // promise rejection.
    invocation.completion.promise.catch(() => undefined);
    this.invocationsByOriginId.set(id, invocation);
    this.pendingAccepts.push(invocation);

    if (opts.signal !== undefined) {
      const sig = opts.signal;
      const onAbort = (): void => {
        if (invocation.jobId !== null) {
          void this.cancelJob(invocation.jobId, {
            reason: String(sig.reason ?? "abort"),
          });
        }
      };
      if (sig.aborted) {
        invocation.acceptance.reject(
          new CancelledError("aborted before submit"),
        );
        return makeHandleFromInvocation(invocation);
      }
      sig.addEventListener("abort", onAbort, { once: true });
    }

    await this.transport.send(env);

    // The routeJobEvent path resolves `acceptance` *and* registers the
    // invocation in `invocationsByJobId` before this await returns, so any
    // subsequent events arriving in the same tick will still route.
    await invocation.acceptance.promise;
    return makeHandleFromInvocation(invocation);
  }

  /** Send a `job.cancel` envelope. */
  public async cancelJob(
    jobId: JobId,
    options: { reason?: string } = {},
  ): Promise<void> {
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
   */
  public async ack(seq: number): Promise<void> {
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
   */
  public async listJobs(
    filter?: SessionListJobsFilter,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ jobs: JobListEntry[]; nextCursor: string | null }> {
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
   */
  public async subscribe(
    jobId: JobId,
    opts: { history?: boolean; fromEventSeq?: number } = {},
  ): Promise<JobSubscription> {
    if (!this.hasFeature("subscribe")) {
      throw new InvalidRequestError(
        "job.subscribe requires the 'subscribe' feature to be negotiated",
      );
    }
    if (this.transport === null)
      throw new InvalidRequestError("Client not connected");
    const sessionId = this.state.id;
    if (sessionId === undefined)
      throw new InvalidRequestError("session has no id");
    const deferred = new Deferred<JobSubscribedPayload>();
    this.pendingSubscribes.set(jobId, deferred);
    const id = newMessageId();
    const env = buildEnvelope({
      id,
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
    await this.transport.send(env);
    const ack = await deferred.promise;
    return {
      jobId,
      subscribedFrom: ack.subscribed_from,
      replayed: ack.replayed,
      unsubscribe: async () => {
        if (this.transport === null) return;
        const env = buildEnvelope({
          id: newMessageId(),
          type: "job.unsubscribe" as const,
          payload: { job_id: jobId },
          optional: { session_id: sessionId },
        });
        try {
          await this.transport.send(env);
        } catch {
          // best-effort
        }
      },
    };
  }

  // -------------------------------------------------------------------

  private async dispatchRaw(frame: WireFrame): Promise<void> {
    let parsed: BaseEnvelope;
    try {
      parsed = RoundTripEnvelopeSchema.parse(frame);
    } catch (error) {
      this.logger.warn({ err: error }, "client received malformed frame");
      return;
    }

    // Handshake.
    if (parsed.type === "session.welcome") {
      const result = EnvelopeSchema.safeParse(parsed);
      if (result.success && result.data.type === "session.welcome") {
        // Assign session id from the envelope itself.
        // session_id is typed as required by the schema, but we keep the runtime
        // check in case the server omits it on the wire.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (result.data.session_id !== undefined) {
          try {
            this.state.assignId(result.data.session_id);
          } catch {
            // ignore — likely a resume on the same id
          }
        }
        this.handshake?.resolve(result.data.payload);
      }
      return;
    }
    if (parsed.type === "session.error") {
      const result = EnvelopeSchema.safeParse(parsed);
      if (result.success && result.data.type === "session.error") {
        const err = ARCPError.fromPayload(result.data.payload);
        if (this.handshake !== null && !this.handshake.settled) {
          this.handshake.reject(err);
        }
        // Reject all in-flight submissions.
        for (const inv of this.invocationsByOriginId.values()) {
          if (!inv.acceptance.settled) inv.acceptance.reject(err);
          if (!inv.completion.settled) inv.completion.reject(err);
        }
        for (const d of this.pendingLists.values()) {
          if (!d.settled) d.reject(err);
        }
        for (const d of this.pendingSubscribes.values()) {
          if (!d.settled) d.reject(err);
        }
      }
      return;
    }

    // v1.1 §6.4 — respond to inbound session.ping with session.pong.
    if (parsed.type === "session.ping") {
      const result = EnvelopeSchema.safeParse(parsed);
      if (result.success && result.data.type === "session.ping") {
        const sessionId = this.state.id;
        if (sessionId !== undefined && this.transport !== null) {
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
            await this.transport.send(pongEnv);
          } catch {
            // best-effort
          }
        }
      }
      return;
    }
    if (parsed.type === "session.pong") {
      // No-op on the client side beyond updating activity.
      return;
    }

    // Validate, then route.
    const result = EnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      this.logger.warn(
        { type: parsed.type, code: issue?.code, message: issue?.message },
        "client received unparseable envelope",
      );
      return;
    }
    const env = result.data;
    // Track event_seq for resume.
    if (env.event_seq !== undefined && env.event_seq > this.lastEventSeq) {
      this.lastEventSeq = env.event_seq;
      this.scheduleAutoAck();
    }
    // v1.1 §6.6 — session.jobs (response to list_jobs).
    if (env.type === "session.jobs") {
      const reqId = env.payload.request_id;
      const deferred = this.pendingLists.get(reqId);
      if (deferred !== undefined) {
        this.pendingLists.delete(reqId);
        deferred.resolve(env.payload);
        return;
      }
    }
    // v1.1 §7.6 — job.subscribed (response to subscribe).
    // job_id is required by the schema, but we keep the runtime check.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (env.type === "job.subscribed" && env.job_id !== undefined) {
      const d = this.pendingSubscribes.get(env.job_id);
      if (d !== undefined) {
        this.pendingSubscribes.delete(env.job_id);
        d.resolve(env.payload);
        return;
      }
    }

    this.routeJobEvent(env);
    const handler = this.handlers.get(env.type);
    if (handler !== undefined) {
      try {
        await handler(env);
      } catch (error) {
        this.logger.error(
          { err: error, type: env.type },
          "client handler threw",
        );
      }
      return;
    }
    this.logger.debug(
      { type: env.type },
      "no client handler registered for type",
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

  private routeJobEvent(env: Envelope): void {
    if (env.type === "job.accepted") {
      // Bind to the oldest still-pending submit. Register the invocation in
      // the by-job-id map synchronously here so that the very-next inbound
      // frame (status / result / error) can still be routed even if the
      // submit() continuation hasn't yet run from the microtask queue.
      const inv = this.pendingAccepts.shift();
      if (inv !== undefined && !inv.acceptance.settled) {
        const payload = env.payload;
        inv.jobId = payload.job_id;
        inv.lease = payload.lease;
        inv.agent = payload.agent;
        inv.leaseConstraints = payload.lease_constraints;
        inv.budget = payload.budget;
        inv.traceId = payload.trace_id ?? inv.traceId;
        this.invocationsByJobId.set(payload.job_id, inv);
        inv.acceptance.resolve(payload);
      }
      return;
    }

    // job_id is required by the schema, but we keep the runtime check.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (env.type === "job.event" && env.job_id !== undefined) {
      const inv = this.invocationsByJobId.get(env.job_id);
      if (inv !== undefined) {
        const ep = env.payload;
        inv.events.push(ep);
        // v1.1 §8.4 — accumulate result_chunk bodies for later assembly.
        if (ep.kind === "result_chunk") {
          const body = ep.body as ResultChunkBody;
          let bucket = inv.chunks.get(body.result_id);
          if (bucket === undefined) {
            bucket = [];
            inv.chunks.set(body.result_id, bucket);
          }
          bucket.push(body);
        }
      }
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (env.type === "job.result" && env.job_id !== undefined) {
      const inv = this.invocationsByJobId.get(env.job_id);
      if (inv !== undefined) {
        inv.completion.resolve(env.payload);
        this.invocationsByJobId.delete(env.job_id);
      }
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (env.type === "job.error" && env.job_id !== undefined) {
      const payload = env.payload;
      const err = ARCPError.fromPayload(jobErrorToErrorPayload(payload));
      let inv = this.invocationsByJobId.get(env.job_id);
      if (inv === undefined) {
        // No binding yet — this can happen when the runtime rejects the
        // submit (AGENT_NOT_AVAILABLE, DUPLICATE_KEY, etc) without ever
        // emitting job.accepted. Bind to the oldest pending submit.
        inv = this.pendingAccepts.shift();
        if (inv !== undefined) {
          inv.jobId = env.job_id;
          this.invocationsByJobId.set(env.job_id, inv);
        }
      }
      if (inv !== undefined) {
        if (!inv.acceptance.settled) inv.acceptance.reject(err);
        inv.completion.reject(err);
        this.invocationsByJobId.delete(env.job_id);
      }
      return;
    }
  }
}

function makeHandleFromInvocation(inv: InvocationState): JobHandle {
  return {
    get jobId(): JobId {
      return inv.jobId ?? ("" as JobId);
    },
    get lease() {
      return inv.lease ?? {};
    },
    get agent() {
      return inv.agent;
    },
    get leaseConstraints() {
      return inv.leaseConstraints;
    },
    get budget() {
      return inv.budget;
    },
    get traceId() {
      return inv.traceId;
    },
    done: inv.completion.promise,
    async collectChunks(): Promise<Buffer | string> {
      const result = await inv.completion.promise;
      const resultId = result.result_id;
      if (resultId === undefined) {
        throw new InvalidRequestError(
          "job.result has no result_id; no chunks to collect",
        );
      }
      const chunks = inv.chunks.get(resultId);
      if (chunks === undefined || chunks.length === 0) {
        return "";
      }
      const sorted = chunks.toSorted((a, b) => a.chunk_seq - b.chunk_seq);
      const encoding = sorted[0]?.encoding ?? "utf8";
      if (encoding === "base64") {
        const buffers = sorted.map((c) => Buffer.from(c.data, "base64"));
        return Buffer.concat(buffers);
      }
      return sorted.map((c) => c.data).join("");
    },
  };
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

// Silence unused — re-exported for future timers.
void randomBytes;
