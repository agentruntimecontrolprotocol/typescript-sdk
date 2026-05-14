import type { BearerIdentity } from "../auth/bearer.js";
import { InvalidRequestError, UnauthenticatedError } from "../errors.js";
import type { Capabilities } from "../messages/session.js";

// ARCP v1.0 session lifecycle. Phases:
//
//   opening   — pre-welcome
//   accepted  — post-welcome, live
//   closing   — `session.bye` in flight
//   rejected  — `session.error` (terminal)
//
// `extensions` capability flag is gone in v1.0.

/**
 * Phases of a single ARCP session.
 *
 * @see ARCP v1.0 §6.
 */
export type SessionPhase = "opening" | "accepted" | "closing" | "rejected";

const VALID_TRANSITIONS: Record<SessionPhase, ReadonlySet<SessionPhase>> = {
  opening: new Set<SessionPhase>(["accepted", "rejected"]),
  accepted: new Set<SessionPhase>(["closing"]),
  closing: new Set<SessionPhase>([]),
  rejected: new Set<SessionPhase>([]),
};

/** Snapshot of session state shared between server-side and client-side. */
export interface SessionSnapshot {
  readonly id: string | undefined;
  readonly phase: SessionPhase;
  readonly identity: BearerIdentity | undefined;
  readonly capabilities: Capabilities | undefined;
}

/**
 * Mutable session state managed by the runtime/client. Tracks the §6 phase
 * machine and the negotiated capabilities.
 *
 * Illegal transitions throw {@link InvalidRequestError}.
 */
export class SessionState {
  private _phase: SessionPhase = "opening";
  private _id: string | undefined;
  private _identity: BearerIdentity | undefined;
  private _capabilities: Capabilities | undefined;

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
  public get isAccepted(): boolean {
    return this._phase === "accepted";
  }

  public transition(next: SessionPhase): void {
    const allowed = VALID_TRANSITIONS[this._phase];
    if (!allowed.has(next)) {
      throw new InvalidRequestError(
        `Illegal session transition: ${this._phase} → ${next}`,
        {
          details: { from: this._phase, to: next },
        },
      );
    }
    this._phase = next;
  }

  public assignId(id: string): void {
    if (this._id !== undefined && this._id !== id) {
      throw new InvalidRequestError("session_id already assigned");
    }
    this._id = id;
  }

  public assignIdentity(identity: BearerIdentity): void {
    this._identity = identity;
  }

  public assignCapabilities(caps: Capabilities): void {
    this._capabilities = caps;
  }

  /** Throw if the session has not advanced to `accepted` (§6). */
  public requireAccepted(): void {
    if (!this.isAccepted) {
      throw new UnauthenticatedError(
        `Session not accepted yet (phase=${this._phase}); pre-handshake traffic rejected`,
      );
    }
  }

  public snapshot(): SessionSnapshot {
    return {
      id: this._id,
      phase: this._phase,
      identity: this._identity,
      capabilities: this._capabilities,
    };
  }
}

/**
 * Coalesce the client- and runtime-advertised capability lists for §6.2.
 *
 * v1.0 capabilities is an announcement, not a negotiation. We intersect
 * `encodings`, forward `agents` from the runtime, and round-trip any
 * vendor (`x-vendor.*`) keys from either side.
 */
export function negotiateCapabilities(
  client: Capabilities | undefined,
  runtime: Capabilities,
): Capabilities {
  const out: Capabilities = {};
  const c: Capabilities = client ?? {};
  const clientEncodings = Array.isArray(c.encodings) ? c.encodings : undefined;
  const runtimeEncodings = Array.isArray(runtime.encodings)
    ? runtime.encodings
    : undefined;
  if (clientEncodings !== undefined && runtimeEncodings !== undefined) {
    out.encodings = clientEncodings.filter((e) => runtimeEncodings.includes(e));
  } else if (clientEncodings !== undefined) {
    out.encodings = clientEncodings;
  } else if (runtimeEncodings !== undefined) {
    out.encodings = runtimeEncodings;
  }
  if (Array.isArray(runtime.agents)) {
    out.agents = runtime.agents;
  }
  // Round-trip vendor-prefixed keys from either side.
  const known = new Set(["encodings", "agents"]);
  for (const k of Object.keys(c)) {
    if (known.has(k)) continue;
    (out as Record<string, unknown>)[k] = (c as Record<string, unknown>)[k];
  }
  for (const k of Object.keys(runtime)) {
    if (known.has(k)) continue;
    if (!(k in out)) {
      (out as Record<string, unknown>)[k] = (
        runtime as Record<string, unknown>
      )[k];
    }
  }
  return out;
}
