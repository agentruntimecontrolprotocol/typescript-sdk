import { z } from "zod";
import { type BaseEnvelope, buildEnvelope, RoundTripEnvelopeSchema } from "../envelope.js";
import { ARCPError, FailedPreconditionError, UnauthenticatedError } from "../errors.js";
import { type Logger, rootLogger } from "../logger.js";
import {
  type AuthScheme,
  type Capabilities,
  type ClientIdentity,
  type Envelope,
  EnvelopeSchema,
  type SessionAcceptedPayload,
} from "../messages/index.js";
import { SessionState } from "../runtime/session.js";
import type { Transport, WireFrame } from "../transport/base.js";
import { Deferred } from "../util/deferred.js";
import { newMessageId, nowTimestamp } from "../util/ulid.js";

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
}

/** Inbound-message handler on the client side. */
export type ClientHandler = (env: Envelope) => Promise<void> | void;

/**
 * ARCP client. v0.1 covers the §8 handshake and provides hooks for sending
 * commands and receiving events. Phase 3+ adds typed `invoke()` and
 * `subscribe()` wrappers on top of this surface.
 */
export class ARCPClient {
  public readonly state = new SessionState();
  public readonly logger: Logger;
  private readonly handlers = new Map<string, ClientHandler>();
  private transport: Transport | null = null;
  private handshake: Deferred<SessionAcceptedPayload> | null = null;
  private readonly handshakeTimeoutMs: number;

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
    if (this.transport === null) return;
    await this.transport.close(reason);
    this.transport = null;
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
