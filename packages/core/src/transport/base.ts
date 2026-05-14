/**
 * Transport interface — the seam between protocol logic and the wire.
 *
 * Both sides of an ARCP session expose a {@link Transport}. The runtime
 * accepts inbound transports; the client opens a single transport against a
 * runtime. WebSocket, stdio, and the in-memory test transport all implement
 * this interface.
 *
 * Transports MUST preserve message body and delivery contract per RFC 0001
 * v2 §22. Ordering inside a `stream_id`/`job_id` is the only ordering
 * guarantee the protocol relies on.
 */

import type { BaseEnvelope } from "../envelope.js";

/** Raw message frame: a JSON-encodable object. */
export type WireFrame = Record<string, unknown>;

/**
 * Anything that may be handed to {@link Transport.send}. Accepts a typed
 * {@link BaseEnvelope} (the common case — outbound traffic is always typed)
 * or a raw {@link WireFrame} (used when forwarding a frame received from
 * another peer without re-typing it).
 */
export type SendableFrame = BaseEnvelope | WireFrame;

/** A handler for inbound frames; returns the parsed-and-dispatched promise. */
export type FrameHandler = (frame: WireFrame) => Promise<void> | void;

/**
 * Bidirectional transport. The implementer is responsible for delivering
 * frames in the order they were passed to {@link send}.
 */
export interface Transport {
  /** Send a frame to the peer. May reject if the transport is closed. */
  send(frame: SendableFrame): Promise<void>;

  /**
   * Register the handler called for each inbound frame.
   *
   * Implementations MUST invoke `handler` once per frame in receive order,
   * awaiting the returned promise before delivering the next frame to
   * preserve ordering inside a stream/job.
   */
  onFrame(handler: FrameHandler): void;

  /** Register a one-shot handler invoked when the peer closes the transport. */
  onClose(handler: (err?: Error) => void): void;

  /** Close the transport. Idempotent. */
  close(reason?: string): Promise<void>;

  /** Whether the transport has been closed. */
  readonly closed: boolean;
}
