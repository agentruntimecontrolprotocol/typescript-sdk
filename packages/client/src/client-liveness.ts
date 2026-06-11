import type { SessionId } from "@agentruntimecontrolprotocol/core";
import type { BaseEnvelope } from "@agentruntimecontrolprotocol/core/envelope";
import { HeartbeatLostError } from "@agentruntimecontrolprotocol/core/errors";
import type { Logger } from "@agentruntimecontrolprotocol/core/logger";
import type { SessionWelcomePayload } from "@agentruntimecontrolprotocol/core/messages";

import type { ARCPClientOptions } from "./types.js";

/**
 * Collaborators the liveness controller needs from {@link ARCPClient} without
 * taking a hard reference to the client class (avoids a private-field coupling
 * and keeps this module independently testable).
 */
export interface LivenessDeps {
  readonly logger: Logger;
  readonly options: ARCPClientOptions;
  hasFeature(name: string): boolean;
  /** Send a `session.ack` for the given seq (delegates to `ARCPClient.ack`). */
  sendAck(seq: number): Promise<void>;
  /** Current session id, if assigned. */
  getSessionId(): SessionId | undefined;
  /** Latest `resume_token`, surfaced to the session-broken callback. */
  getResumeToken(): string | undefined;
}

/**
 * Owns the §6.4 heartbeat/liveness watchdog, the §6.5 auto-ack scheduler, and
 * §8.3 `event_seq` gap detection — the parts of the client lifecycle that track
 * inbound liveness and the contiguity cursor. Extracted from `client.ts` so the
 * public {@link ARCPClient} facade stays a thin protocol surface (#133).
 */
export class ClientLiveness {
  /** Latest `event_seq` observed for this session. Used on resume. */
  private lastEventSeq = 0;
  /** v1.1 §8.3 — set once an `event_seq` gap breaks ordering guarantees. */
  private sessionBroken = false;
  /** v1.1 §6.4 — negotiated heartbeat interval in ms (0 = disabled). */
  private heartbeatIntervalMs = 0;
  /** v1.1 §6.4 — inactivity timer; fires HEARTBEAT_LOST after two intervals. */
  private livenessTimer: ReturnType<typeof setTimeout> | null = null;
  /** v1.1 §6.5 — auto-ack scheduler state. */
  private readonly autoAckOpts: {
    intervalMs: number;
    minSeqDelta: number;
  } | null = null;
  private autoAckTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAckedSeq = 0;

  public constructor(private readonly deps: LivenessDeps) {
    const autoAck = deps.options.autoAck;
    if (autoAck !== undefined && autoAck !== false) {
      const o = autoAck === true ? {} : autoAck;
      this.autoAckOpts = {
        intervalMs: o.intervalMs ?? 250,
        minSeqDelta: o.minSeqDelta ?? 32,
      };
    }
  }

  public get lastEventSeqObserved(): number {
    return this.lastEventSeq;
  }

  public get isSessionBroken(): boolean {
    return this.sessionBroken;
  }

  /**
   * Seed the contiguity cursor from a resume point so replayed events
   * (event_seq > last_event_seq) are not misread as a §8.3 gap.
   */
  public seedFromResume(lastEventSeq: number): void {
    this.lastEventSeq = lastEventSeq;
    this.sessionBroken = false;
  }

  /** Start the §6.4 liveness watchdog when heartbeat was negotiated. */
  public start(welcome: SessionWelcomePayload): void {
    const interval = welcome.heartbeat_interval_sec;
    if (
      !this.deps.hasFeature("heartbeat") ||
      interval === undefined ||
      interval <= 0
    ) {
      return;
    }
    this.heartbeatIntervalMs = interval * 1000;
    this.touch();
  }

  /** §6.4 — any inbound frame is evidence the peer is alive; re-arm the timer. */
  public touch(): void {
    if (this.heartbeatIntervalMs <= 0) return;
    if (this.livenessTimer !== null) clearTimeout(this.livenessTimer);
    // §6.4 — two silent intervals is the conventional liveness budget.
    this.livenessTimer = setTimeout(() => {
      this.livenessTimer = null;
      this.handleHeartbeatLost();
    }, this.heartbeatIntervalMs * 2);
    this.livenessTimer.unref();
  }

  /** Tear down all timers (on close). */
  public clear(): void {
    if (this.livenessTimer !== null) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
    if (this.autoAckTimer !== null) {
      clearTimeout(this.autoAckTimer);
      this.autoAckTimer = null;
    }
  }

  /** Record the highest seq the client has acknowledged. */
  public recordAcked(seq: number): void {
    if (seq > this.lastAckedSeq) this.lastAckedSeq = seq;
  }

  /** Track the contiguity cursor for an inbound envelope (§8.3). */
  public observeEventSeq(env: BaseEnvelope): void {
    if (env.event_seq === undefined) return;
    if (env.event_seq <= this.lastEventSeq) return;
    // §8.3 — event_seq is contiguous per session; a jump past the expected
    // next value means we missed an event. Treat the session as broken and
    // surface a resume signal rather than silently accepting a hole.
    if (env.event_seq > this.lastEventSeq + 1) {
      this.handleEventSeqGap(env.event_seq);
    }
    this.lastEventSeq = env.event_seq;
    this.scheduleAutoAck();
  }

  private handleHeartbeatLost(): void {
    const lostError = new HeartbeatLostError(
      "No inbound frames within two heartbeat intervals (§6.4)",
    );
    this.deps.logger.warn(
      { heartbeatIntervalMs: this.heartbeatIntervalMs },
      "heartbeat lost; connection appears dead",
    );
    const cb = this.deps.options.onHeartbeatLost;
    if (cb === undefined) return;
    try {
      cb(lostError);
    } catch (error) {
      this.deps.logger.error(
        { err: error },
        "onHeartbeatLost callback threw; ignoring",
      );
    }
  }

  private handleEventSeqGap(receivedEventSeq: number): void {
    // Mark broken before notifying so the callback observes a consistent
    // state. Only fire the callback on the first gap to avoid a storm if the
    // peer keeps sending past the hole.
    if (this.sessionBroken) return;
    this.sessionBroken = true;
    this.deps.logger.warn(
      {
        lastEventSeq: this.lastEventSeq,
        receivedEventSeq,
        sessionId: this.deps.getSessionId(),
      },
      "event_seq gap detected; session marked broken (§8.3)",
    );
    const onBroken = this.deps.options.onSessionBroken;
    if (onBroken === undefined) return;
    try {
      onBroken({
        lastEventSeq: this.lastEventSeq,
        receivedEventSeq,
        sessionId: this.deps.getSessionId(),
        resumeToken: this.deps.getResumeToken(),
      });
    } catch (error) {
      this.deps.logger.error(
        { err: error },
        "onSessionBroken callback threw; ignoring",
      );
    }
  }

  private scheduleAutoAck(): void {
    if (this.autoAckOpts === null) return;
    if (!this.deps.hasFeature("ack")) return;
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
    if (!this.deps.hasFeature("ack")) return;
    try {
      await this.deps.sendAck(this.lastEventSeq);
    } catch {
      // best-effort
    }
  }
}
