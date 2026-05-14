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
  type AuthScheme,
  type Capabilities,
  type ClientIdentity,
  type Envelope,
  EnvelopeSchema,
  type JobAcceptedPayload,
  type JobErrorPayload,
  type JobEventPayload,
  type JobResultPayload,
  jobErrorToErrorPayload,
  type Lease,
  type SessionResume,
  type SessionWelcomePayload,
} from "@arcp/core/messages";
import { PendingRegistry, SessionState } from "@arcp/core/state";
import type { Transport, WireFrame } from "@arcp/core/transport";
import { Deferred, newMessageId } from "@arcp/core/util";

// ARCP v1.0 client.
//
// Surface:
//   - `connect(transport)`           → handshake, returns SessionWelcomePayload.
//   - `submit({ agent, input, ... })` → sends job.submit, awaits job.accepted.
//   - `cancelJob(jobId, { reason? })` → sends job.cancel.
//   - `close(reason?)`               → sends session.bye then closes transport.

export interface ARCPClientOptions {
  /** Client identity broadcast in `session.hello`. */
  client: ClientIdentity;
  /** Capabilities the client requests/supports. */
  capabilities?: Capabilities;
  /** Auth scheme to use. v1.0 supports `"bearer"` only. */
  authScheme: AuthScheme;
  /** Token, where the scheme requires one. */
  token?: string;
  /** Logger. */
  logger?: Logger;
  /** Handshake timeout in milliseconds. Default 5000. */
  handshakeTimeoutMs?: number;
}

/** Inbound-message handler on the client side. */
export type ClientHandler = (env: Envelope) => Promise<void> | void;

/**
 * Handle returned by {@link ARCPClient.submit}, exposes job lifecycle (§7.3).
 *
 * Resolve `done` to obtain the terminal `job.result.payload`; the promise
 * rejects with an {@link ARCPError} if the runtime emitted `job.error`
 * instead.
 */
export interface JobHandle {
  /** Server-assigned `job.accepted.payload.job_id`. */
  readonly jobId: string;
  /** Effective lease as returned in `job.accepted`. */
  readonly lease: Lease;
  /** Trace id echoed by the runtime, if any. */
  readonly traceId: string | undefined;
  /** Promise that resolves to the final `job.result` payload. */
  readonly done: Promise<JobResultPayload>;
}

/**
 * Options for {@link ARCPClient.submit}. Mirrors `job.submit.payload` (§7.1)
 * plus client-side conveniences (`traceId`, `signal`).
 */
export interface SubmitOptions {
  /** Registered agent name on the runtime. */
  agent: string;
  /** Arbitrary JSON-serializable input forwarded to the agent. */
  input?: unknown;
  /**
   * Lease request (§9.1). Runtime MAY narrow but MUST NOT broaden.
   * Capability namespace → list of glob patterns.
   */
  lease?: Lease;
  /**
   * Logical idempotency key (§7.2). Same `(principal, idempotencyKey)`
   * within the runtime's TTL returns the same `job_id`.
   */
  idempotencyKey?: string;
  /** Job-level deadline. Exceeding it produces `TIMEOUT`. */
  maxRuntimeSec?: number;
  /** Explicit W3C 32-hex trace id. Runtime generates one if omitted. */
  traceId?: string;
  /** Cancel signal. Aborting triggers `cancelJob(jobId)`. */
  signal?: AbortSignal;
}

interface InvocationState {
  jobId: string | null;
  lease: Lease | null;
  traceId: string | undefined;
  events: JobEventPayload[];
  acceptance: Deferred<JobAcceptedPayload>;
  completion: Deferred<JobResultPayload>;
}

/**
 * Client-side driver for an ARCP v1.0 session (§6).
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

  public constructor(public readonly options: ARCPClientOptions) {
    this.logger =
      options.logger ?? rootLogger.child({ component: "arcp-client" });
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5000;
  }

  public get lastEventSeqObserved(): number {
    return this.lastEventSeq;
  }

  public get welcomePayload(): SessionWelcomePayload | null {
    return this.welcome;
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

    const helloId = newMessageId();
    const helloEnv = buildEnvelope({
      id: helloId,
      type: "session.hello" as const,
      payload: {
        client: this.options.client,
        auth: {
          scheme: this.options.authScheme,
          ...(this.options.token !== undefined
            ? { token: this.options.token }
            : {}),
        },
        ...(this.options.capabilities !== undefined
          ? { capabilities: this.options.capabilities }
          : {}),
        ...(resume !== undefined ? { resume } : {}),
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
    if (this.transport === null) return;
    const sessionId = this.state.id;
    if (sessionId !== undefined && this.state.isAccepted) {
      try {
        const env = buildEnvelope({
          id: newMessageId(),
          type: "session.bye" as const,
          payload: reason !== undefined ? { reason } : {},
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
        ...(opts.lease !== undefined ? { lease_request: opts.lease } : {}),
        ...(opts.idempotencyKey !== undefined
          ? { idempotency_key: opts.idempotencyKey }
          : {}),
        ...(opts.maxRuntimeSec !== undefined
          ? { max_runtime_sec: opts.maxRuntimeSec }
          : {}),
      },
      optional: {
        session_id: sessionId,
        ...(opts.traceId !== undefined ? { trace_id: opts.traceId } : {}),
      },
    });

    const invocation: InvocationState = {
      jobId: null,
      lease: null,
      traceId: opts.traceId,
      events: [],
      acceptance: new Deferred<JobAcceptedPayload>(),
      completion: new Deferred<JobResultPayload>(),
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
    jobId: string,
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
      payload: options.reason !== undefined ? { reason: options.reason } : {},
      optional: { session_id: sessionId, job_id: jobId },
    });
    await this.transport.send(env);
  }

  // -------------------------------------------------------------------

  private async dispatchRaw(frame: WireFrame): Promise<void> {
    let parsed: BaseEnvelope;
    try {
      parsed = RoundTripEnvelopeSchema.parse(frame);
    } catch (err) {
      this.logger.warn({ err }, "client received malformed frame");
      return;
    }

    // Handshake.
    if (parsed.type === "session.welcome") {
      const result = EnvelopeSchema.safeParse(parsed);
      if (result.success && result.data.type === "session.welcome") {
        // Assign session id from the envelope itself.
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
      }
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
    }
    this.routeJobEvent(env);
    const handler = this.handlers.get(env.type);
    if (handler !== undefined) {
      try {
        await handler(env);
      } catch (err) {
        this.logger.error({ err, type: env.type }, "client handler threw");
      }
      return;
    }
    this.logger.debug(
      { type: env.type },
      "no client handler registered for type",
    );
  }

  private routeJobEvent(env: Envelope): void {
    if (env.type === "job.accepted") {
      // Bind to the oldest still-pending submit. Register the invocation in
      // the by-job-id map synchronously here so that the very-next inbound
      // frame (status / result / error) can still be routed even if the
      // submit() continuation hasn't yet run from the microtask queue.
      const inv = this.pendingAccepts.shift();
      if (inv !== undefined && !inv.acceptance.settled) {
        const payload = env.payload as JobAcceptedPayload;
        inv.jobId = payload.job_id;
        inv.lease = payload.lease;
        inv.traceId = payload.trace_id ?? inv.traceId;
        this.invocationsByJobId.set(payload.job_id, inv);
        inv.acceptance.resolve(payload);
      }
      return;
    }
    if (env.type === "job.event" && env.job_id !== undefined) {
      const inv = this.invocationsByJobId.get(env.job_id);
      if (inv !== undefined) inv.events.push(env.payload as JobEventPayload);
      return;
    }
    if (env.type === "job.result" && env.job_id !== undefined) {
      const inv = this.invocationsByJobId.get(env.job_id);
      if (inv !== undefined) {
        inv.completion.resolve(env.payload as JobResultPayload);
        this.invocationsByJobId.delete(env.job_id);
      }
      return;
    }
    if (env.type === "job.error" && env.job_id !== undefined) {
      const payload = env.payload as JobErrorPayload;
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
    get jobId() {
      return inv.jobId ?? "";
    },
    get lease() {
      return inv.lease ?? {};
    },
    get traceId() {
      return inv.traceId;
    },
    done: inv.completion.promise,
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
