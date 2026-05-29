import type { JobId, TraceId } from "@agentruntimecontrolprotocol/core";
import type { HeartbeatLostError } from "@agentruntimecontrolprotocol/core/errors";
import type { Logger } from "@agentruntimecontrolprotocol/core/logger";
import type {
  AuthScheme,
  Capabilities,
  ClientIdentity,
  Envelope,
  JobResultPayload,
  Lease,
  LeaseConstraints,
  Credential,
} from "@agentruntimecontrolprotocol/core/messages";

/**
 * v1.1 §6.5 — automatic event acknowledgement options. When enabled, the
 * client periodically emits `session.ack` with the highest observed
 * `event_seq` to allow the runtime to free buffered events earlier than
 * the time-based window.
 *
 * Coalescing: an ack is emitted at most every `intervalMs` (default 250)
 * or after `minSeqDelta` new events (default 32), whichever comes first.
 */
export interface ClientAutoAckOptions {
  intervalMs?: number;
  minSeqDelta?: number;
}

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
  /**
   * v1.1 §6.2 — feature flags this client advertises. Defaults to every v1.1
   * feature.
   */
  features?: readonly string[];
  /**
   * v1.1 §6.5 — automatic `session.ack` emission. `true` enables defaults
   * (250ms, 32 events). `false` disables auto-ack entirely. Default `false`.
   */
  autoAck?: boolean | ClientAutoAckOptions;
  /**
   * v1.1 §8.3 — invoked when the client detects an `event_seq` gap (a missed
   * event). The session is marked broken before the callback runs; the
   * callback SHOULD recover by calling {@link ARCPClient.resume} on a fresh
   * transport using the cursor in {@link SessionBrokenInfo}.
   */
  onSessionBroken?: (info: SessionBrokenInfo) => void;
  /**
   * v1.1 §6.4 — invoked when no inbound frame arrives within two negotiated
   * `heartbeat_interval_sec` windows (only active when the `heartbeat` feature
   * is negotiated and the runtime advertised an interval). Detection is a
   * spec MAY; use this to tear down or resume a silently-dead connection.
   */
  onHeartbeatLost?: (error: HeartbeatLostError) => void;
}

/**
 * v1.1 §8.3 — context for an `event_seq` gap that broke session ordering.
 */
export interface SessionBrokenInfo {
  /** Highest contiguous `event_seq` the client observed before the gap. */
  readonly lastEventSeq: number;
  /** The out-of-order `event_seq` that exposed the gap. */
  readonly receivedEventSeq: number;
  /** Session id to resume, when known. */
  readonly sessionId: string | undefined;
  /** Resume token from the latest `session.welcome`, when available. */
  readonly resumeToken: string | undefined;
}

/** Inbound-message handler on the client side. */
export type ClientHandler = (env: Envelope) => Promise<void> | void;

/**
 * Handle returned by `ARCPClient.submit`, exposes job lifecycle (§7.3).
 *
 * Resolve `done` to obtain the terminal `job.result.payload`; the promise
 * rejects with an `ARCPError` if the runtime emitted `job.error` instead.
 *
 * v1.1: when the runtime streams the result via `result_chunk` events, the
 * `done` payload carries `result_id` instead of an inline `result`. Use
 * `collectChunks` to assemble the chunks.
 */
export interface JobHandle {
  /** Server-assigned `job.accepted.payload.job_id`. */
  readonly jobId: JobId;
  /** Effective lease as returned in `job.accepted`. */
  readonly lease: Lease;
  /** Trace id echoed by the runtime, if any. */
  readonly traceId: TraceId | undefined;
  /**
   * Resolved agent identifier echoed by the runtime
   * (v1.1 `name@version` form when versioning is in play).
   */
  readonly agent: string | undefined;
  /** v1.1 — lease constraints echoed by the runtime. */
  readonly leaseConstraints: LeaseConstraints | undefined;
  /** v1.1 — initial budget echoed by the runtime. */
  readonly budget: Readonly<Record<string, number>> | undefined;
  /** v1.1 §9.8 — provisioned credentials minted for this job, if any. */
  readonly credentials: readonly Credential[] | undefined;
  /** Promise that resolves to the final `job.result` payload. */
  readonly done: Promise<JobResultPayload>;
  /**
   * v1.1 §8.4 — assemble streamed chunks into a single buffer. Resolves
   * after `done`. Throws if the job did not stream a chunked result.
   */
  collectChunks(): Promise<Buffer | string>;
}

/**
 * v1.1 §7.6 — handle returned by `ARCPClient.subscribe`. Use `unsubscribe()`
 * to release the subscription.
 */
export interface JobSubscription {
  readonly jobId: JobId;
  readonly subscribedFrom: number;
  readonly replayed: boolean;
  unsubscribe(): Promise<void>;
}

/**
 * Options for `ARCPClient.submit`. Mirrors `job.submit.payload` (§7.1) plus
 * client-side conveniences (`traceId`, `signal`).
 */
export interface SubmitOptions {
  /** Registered agent name (optionally `name@version`) on the runtime. */
  agent: string;
  /** Arbitrary JSON-serializable input forwarded to the agent. */
  input?: unknown;
  /**
   * Lease request (§9.1). Runtime MAY narrow but MUST NOT broaden.
   * Capability namespace → list of glob patterns.
   */
  lease?: Lease;
  /** v1.1 §9.5 — lease constraints (currently `expires_at`). */
  leaseConstraints?: LeaseConstraints;
  /**
   * Logical idempotency key (§7.2). Same `(principal, idempotencyKey)`
   * within the runtime's TTL returns the same `job_id`.
   */
  idempotencyKey?: string;
  /** Job-level deadline. Exceeding it produces `TIMEOUT`. */
  maxRuntimeSec?: number;
  /** Explicit W3C 32-hex trace id. Runtime generates one if omitted. */
  traceId?: TraceId;
  /** Cancel signal. Aborting triggers `cancelJob(jobId)`. */
  signal?: AbortSignal;
}
