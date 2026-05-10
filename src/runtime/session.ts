import type { BearerIdentity } from "../auth/bearer.js";
import { FailedPreconditionError, UnauthenticatedError } from "../errors.js";
import type { Capabilities } from "../messages/session.js";

/**
 * Phases of a single ARCP session, drawn from §8.1 + §9.
 *
 * @see PLAN.md §3.1.
 */
export type SessionPhase =
  | "opening"
  | "challenged"
  | "authenticating"
  | "accepted"
  | "refreshing"
  | "closing"
  | "evicted"
  | "rejected";

const VALID_TRANSITIONS: Record<SessionPhase, ReadonlySet<SessionPhase>> = {
  opening: new Set<SessionPhase>(["challenged", "accepted", "rejected"]),
  challenged: new Set<SessionPhase>(["authenticating", "rejected"]),
  authenticating: new Set<SessionPhase>(["accepted", "rejected"]),
  accepted: new Set<SessionPhase>(["refreshing", "closing", "evicted"]),
  refreshing: new Set<SessionPhase>(["accepted", "evicted"]),
  closing: new Set<SessionPhase>([]),
  evicted: new Set<SessionPhase>([]),
  rejected: new Set<SessionPhase>([]),
};

/** Snapshot of session state shared between server-side and client-side. */
export interface SessionSnapshot {
  readonly id: string | undefined;
  readonly phase: SessionPhase;
  readonly identity: BearerIdentity | undefined;
  readonly capabilities: Capabilities | undefined;
  readonly heartbeatInterval: number;
}

/**
 * Mutable session state managed by the runtime/client. Tracks the §8 phase
 * machine, the negotiated capabilities (§7), and the principal that owns
 * the session.
 *
 * Illegal transitions throw {@link FailedPreconditionError}.
 */
export class SessionState {
  private _phase: SessionPhase = "opening";
  private _id: string | undefined;
  private _identity: BearerIdentity | undefined;
  private _capabilities: Capabilities | undefined;
  private _heartbeatInterval = 30;

  public get phase(): SessionPhase {
    return this._phase;
  }
  public get id(): string | undefined {
    return this._id;
  }
  public get identity(): BearerIdentity | undefined {
    return this._identity;
  }
  public get capabilities(): Capabilities | undefined {
    return this._capabilities;
  }
  public get heartbeatInterval(): number {
    return this._heartbeatInterval;
  }
  public get isAccepted(): boolean {
    return this._phase === "accepted" || this._phase === "refreshing";
  }

  /**
   * Transition to a new phase. Throws if the transition is invalid per
   * {@link VALID_TRANSITIONS}.
   */
  public transition(next: SessionPhase): void {
    const allowed = VALID_TRANSITIONS[this._phase];
    if (!allowed.has(next)) {
      throw new FailedPreconditionError(`Illegal session transition: ${this._phase} → ${next}`, {
        details: { from: this._phase, to: next },
      });
    }
    this._phase = next;
  }

  public assignId(id: string): void {
    if (this._id !== undefined && this._id !== id) {
      throw new FailedPreconditionError("session_id already assigned");
    }
    this._id = id;
  }

  public assignIdentity(identity: BearerIdentity): void {
    this._identity = identity;
  }

  public assignCapabilities(caps: Capabilities): void {
    this._capabilities = caps;
    if (caps.heartbeat_interval_seconds !== undefined) {
      this._heartbeatInterval = caps.heartbeat_interval_seconds;
    }
  }

  /** Throw if the session has not advanced to `accepted` (§4.6). */
  public requireAccepted(): void {
    if (!this.isAccepted) {
      throw new UnauthenticatedError(
        `Session not accepted yet (phase=${this._phase}); pre-handshake traffic rejected (§4.6)`,
      );
    }
  }

  public snapshot(): SessionSnapshot {
    return {
      id: this._id,
      phase: this._phase,
      identity: this._identity,
      capabilities: this._capabilities,
      heartbeatInterval: this._heartbeatInterval,
    };
  }
}

/**
 * Compute the negotiated capabilities (§7).
 *
 * Each side advertises booleans; the result is the AND of both. Required-but-
 * unsupported features must be detected by the caller before calling this:
 * the result is purely a coalesced view.
 *
 * `heartbeat_interval_seconds` is reduced to the minimum advertised (more
 * frequent heartbeats win); see PLAN.md §4 open question 4.
 */
export function negotiateCapabilities(client: Capabilities, runtime: Capabilities): Capabilities {
  const out: Capabilities = {};
  const keys = new Set<string>([...Object.keys(client), ...Object.keys(runtime)]);
  for (const k of keys) {
    const cv = client[k as keyof Capabilities];
    const rv = runtime[k as keyof Capabilities];
    if (typeof cv === "boolean" && typeof rv === "boolean") {
      (out as Record<string, unknown>)[k] = cv && rv;
    } else if (k === "heartbeat_interval_seconds") {
      const candidates = [cv, rv].filter((x): x is number => typeof x === "number");
      if (candidates.length > 0) {
        out.heartbeat_interval_seconds = Math.min(...candidates);
      }
    } else if (k === "extensions") {
      const ce = Array.isArray(cv) ? (cv as readonly string[]) : [];
      const re = Array.isArray(rv) ? (rv as readonly string[]) : [];
      out.extensions = ce.filter((x) => re.includes(x));
    } else if (cv !== undefined) {
      (out as Record<string, unknown>)[k] = cv;
    } else if (rv !== undefined) {
      (out as Record<string, unknown>)[k] = rv;
    }
  }
  return out;
}
