import type { EventSeq, JobId } from "@agentruntimecontrolprotocol/core";
import {
  type BaseEnvelope,
  buildEnvelope,
  RoundTripEnvelopeSchema,
} from "@agentruntimecontrolprotocol/core/envelope";
import {
  ARCPError,
  HeartbeatLostError,
  InternalError,
  InvalidRequestError,
} from "@agentruntimecontrolprotocol/core/errors";
import {
  classifyUnknownType,
  CORE_MESSAGE_TYPES,
} from "@agentruntimecontrolprotocol/core/extensions";
import type { Logger } from "@agentruntimecontrolprotocol/core/logger";
import {
  type Envelope,
  EnvelopeSchema,
  type JobErrorPayload,
} from "@agentruntimecontrolprotocol/core/messages";
import {
  PendingRegistry,
  SessionState,
} from "@agentruntimecontrolprotocol/core/state";
import type {
  Transport,
  WireFrame,
} from "@agentruntimecontrolprotocol/core/transport";
import { newMessageId } from "@agentruntimecontrolprotocol/core/util";
import { Either, Schema } from "effect";

import { JobManager } from "./job.js";
import type { ARCPServer } from "./server.js";
import type { EventSeqSource, Handler } from "./types.js";

const decodeRoundTripEnvelope = Schema.decodeUnknownSync(
  RoundTripEnvelopeSchema,
);
const decodeEnvelope = Schema.decodeUnknownEither(EnvelopeSchema);
const KNOWN_CORE_TYPES: ReadonlySet<string> = new Set(CORE_MESSAGE_TYPES);

const HANDSHAKE_TYPES = new Set<string>(["session.hello"]);
// session.ping/pong/ack are session-control envelopes (not event-seq-bearing),
// so they bypass the inbound dedupe-and-log step.
const INBOUND_DEDUPE_SKIP: ReadonlySet<string> = new Set([
  "session.ping",
  "session.pong",
  "session.ack",
]);

const DEFAULT_MAX_BUFFERED_EVENTS = 10_000;
const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024; // 16 MiB
const DEFAULT_BACK_PRESSURE_THRESHOLD = 1000;

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

  public nextEventSeq(): EventSeq {
    this.eventSeq += 1;
    return this.eventSeq;
  }

  public get latestEventSeq(): EventSeq {
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
    // §6.3 / §8.3 — persist BEFORE the wire send so a durable record exists for
    // anything the client could observe. Persisting after sending leaves a hole
    // in the replay buffer if the append fails: the client already holds an
    // `event_seq` the runtime cannot replay, permanently breaking resume.
    await this.persistOutbound(envelope);
    await this.transport.send(envelope);
    // Cap-trip termination runs after the send so the current envelope is not
    // dropped purely because it pushed the buffer over the threshold.
    this.checkCaps();
    await this.fanOutToSubscribers(envelope);
    this.maybeEmitBackPressure();
  }

  private async persistOutbound(envelope: BaseEnvelope): Promise<void> {
    if (envelope.session_id === undefined || envelope.session_id === "") return;
    try {
      await this.server.eventLog.append(envelope);
    } catch (error) {
      this.logger.error({ err: error }, "event log append (outbound) failed");
      // An `event_seq`-bearing envelope that cannot be persisted would create
      // an undetectable gap on resume (`readSinceSeq` would miss it while the
      // client holds it). Treat that as fatal to the send rather than silently
      // emitting an unresumable event. Non-seq envelopes (acks, welcome) are
      // not part of the resume replay, so a persist failure for them is logged
      // and tolerated.
      if (envelope.event_seq !== undefined) {
        throw error instanceof Error
          ? error
          : new InternalError("event log append (outbound) failed");
      }
      return;
    }
    // Account against per-session caps for replay buffer estimation.
    this.bufferedEventCount += 1;
    this.bufferedBytes += JSON.stringify(envelope).length;
  }

  private async fanOutToSubscribers(envelope: BaseEnvelope): Promise<void> {
    if (!isForwardable(envelope)) return;
    const subs = this.server.subscribers.get(envelope.job_id);
    if (subs === undefined || subs.size === 0) return;
    // Deliver concurrently so one slow or wedged subscriber transport cannot
    // stall the owner's send path or starve sibling subscribers. Each
    // delivery is isolated; failures are logged inside the helper.
    const deliveries: Promise<unknown>[] = [];
    for (const sub of subs) {
      if (sub === this || sub.state.id === undefined) continue;
      deliveries.push(this.forwardEnvelopeToSubscriber(sub, envelope));
    }
    if (deliveries.length > 0) await Promise.allSettled(deliveries);
  }

  private async forwardEnvelopeToSubscriber(
    sub: SessionContext,
    envelope: BaseEnvelope,
  ): Promise<void> {
    if (sub.state.id === undefined) return;
    if (sub.closed || sub.transport.closed) return;
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
    // Persist under the subscriber's session id before sending so the
    // forwarded envelope's subscriber-scoped event_seq is resumable, matching
    // the behavior of envelopes emitted by the subscriber's own session.
    try {
      await this.server.eventLog.append(forwarded);
      this.accountForwardedAgainstSubscriber(sub, forwarded);
    } catch (error) {
      this.logger.warn(
        { err: error, subscriber: sub.state.id, type: envelope.type },
        "event log append (subscriber forward) failed",
      );
    }
    try {
      await sub.transport.send(forwarded);
    } catch (error) {
      this.logger.warn(
        { err: error, subscriber: sub.state.id, type: envelope.type },
        "subscriber transport send failed",
      );
    }
  }

  /**
   * §14 — count a forwarded envelope against the *subscriber's* replay buffer
   * just like its own outbound envelopes; without this a subscriber observing
   * a high-volume job would never trip its buffered cap and its replay buffer
   * would grow unbounded.
   */
  private accountForwardedAgainstSubscriber(
    sub: SessionContext,
    forwarded: BaseEnvelope,
  ): void {
    sub.bufferedEventCount += 1;
    sub.bufferedBytes += JSON.stringify(forwarded).length;
    sub.checkCaps();
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
      message: `event_seq lag ${lag} exceeds threshold`,
    });
  }

  private checkCaps(): void {
    const caps = this.server.options.caps ?? {};
    const maxEvents = caps.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
    const maxBytes = caps.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    if (this.bufferedEventCount > maxEvents || this.bufferedBytes > maxBytes) {
      void this.emitSessionError(
        new InternalError("Per-session buffered envelope cap exceeded", {
          retryable: false,
        }),
      );
      void this.terminate("session cap exceeded");
    }
  }

  public async emitSessionError(error: ARCPError): Promise<void> {
    if (this.closed || this.transport.closed) return;
    try {
      const envelope = buildEnvelope({
        id: newMessageId(),
        type: "session.error" as const,
        payload: error.toPayload(),
        ...(this.state.id === undefined
          ? {}
          : { optional: { session_id: this.state.id } }),
      });
      await this.transport.send(envelope);
    } catch (sendError) {
      this.logger.error(
        { err: sendError },
        "failed to emit session.error envelope",
      );
    }
  }

  public async emitJobError(
    jobId: JobId,
    payload: JobErrorPayload,
  ): Promise<void> {
    if (this.closed || this.transport.closed) return;
    const sessionId = this.state.id;
    if (sessionId === undefined) return;
    try {
      const envelope = buildEnvelope({
        id: newMessageId(),
        type: "job.error" as const,
        payload,
        optional: {
          session_id: sessionId,
          job_id: jobId,
          event_seq: this.nextEventSeq(),
        },
      });
      await this.send(envelope);
    } catch (error) {
      this.logger.error({ err: error }, "failed to emit job.error envelope");
    }
  }

  /** Dispatch an inbound, raw frame. */
  public async dispatchRaw(frame: WireFrame): Promise<void> {
    if (this.closed || this.transport.closed) return;
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
      return decodeRoundTripEnvelope(frame);
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
      this.logger.debug(
        { id: parsed.id },
        "duplicate inbound, skipping dispatch",
      );
      return true;
    } catch (error) {
      this.logger.error({ err: error }, "event log append (inbound) failed");
      return false;
    }
  }

  private async validateInbound(
    parsed: BaseEnvelope,
  ): Promise<Envelope | null> {
    const result = decodeEnvelope(parsed);
    if (Either.isRight(result)) return result.right;
    // Mirror zod's `invalid_union_discriminator` behavior: if `type` is not a
    // known core message type, treat as unknown type disposition rather than
    // a generic schema failure.
    if (!KNOWN_CORE_TYPES.has(parsed.type)) {
      await this.handleUnknownTypeDisposition(parsed);
      return null;
    }
    await this.emitSessionError(
      new InvalidRequestError(`Invalid envelope: ${result.left.message}`),
    );
    return null;
  }

  private async handleUnknownTypeDisposition(
    parsed: BaseEnvelope,
  ): Promise<void> {
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
      (this.server.options.heartbeatIntervalSeconds ?? 30) * 1000;
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatTick(intervalMs).catch(() => undefined);
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  private async heartbeatTick(intervalMs: number): Promise<void> {
    if (this.closed || this.transport.closed) return;
    // If we have an outstanding ping that's older than 2 * intervalMs, peer is
    // dead. Emit HEARTBEAT_LOST as session.error and terminate.
    const idleMs = Date.now() - this.lastInboundAt;
    if (idleMs > 2 * intervalMs) {
      await this.emitSessionError(
        new HeartbeatLostError("No inbound activity within 2× heartbeat"),
      );
      await this.closeSession("heartbeat lost", { cancelJobs: false });
      return;
    }
    if (this.state.id === undefined) return;
    const nonce = newMessageId();
    this.outstandingPingNonce = nonce;
    try {
      await this.transport.send(
        buildEnvelope({
          id: newMessageId(),
          type: "session.ping" as const,
          payload: { nonce, sent_at: new Date().toISOString() },
          optional: { session_id: this.state.id },
        }),
      );
    } catch {
      // best-effort
    }
  }

  public handlePong(pingNonce: string): void {
    if (this.outstandingPingNonce !== pingNonce) return;
    this.outstandingPingNonce = null;
    // pong itself counts as inbound activity for the idle check.
    this.lastInboundAt = Date.now();
  }

  public async terminate(reason: string | undefined): Promise<void> {
    await this.closeSession(reason, { cancelJobs: true });
  }

  private async closeSession(
    reason: string | undefined,
    opts: { cancelJobs: boolean },
  ): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (opts.cancelJobs) {
      this.jobs.cancelAll(reason ?? "session terminated");
    }
    this.pending.rejectAll(new InvalidRequestError("session terminated"));
    // Drop subscriptions to other jobs.
    for (const stop of this.subscriptions.values()) {
      try {
        stop();
      } catch {
        // best-effort
      }
    }
    this.subscriptions.clear();
    this.server.dropSession(this);
    await this.transport.close(reason);
  }
}

function isForwardable(
  envelope: BaseEnvelope,
): envelope is BaseEnvelope & { job_id: string } {
  if (envelope.job_id === undefined) return false;
  return (
    envelope.type === "job.event" ||
    envelope.type === "job.result" ||
    envelope.type === "job.error"
  );
}
