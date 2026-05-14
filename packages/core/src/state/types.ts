import type { BearerIdentity } from "../auth/types.js";
import type { Capabilities } from "../messages/types.js";

/**
 * Phases of a single ARCP session.
 *
 * @see ARCP v1.0 §6.
 */
export type SessionPhase = "opening" | "accepted" | "closing" | "rejected";

/** Snapshot of session state shared between server-side and client-side. */
export interface SessionSnapshot {
  readonly id: string | undefined;
  readonly phase: SessionPhase;
  readonly identity: BearerIdentity | undefined;
  readonly capabilities: Capabilities | undefined;
}

/**
 * Per-entry metadata that handlers can stash to validate or annotate
 * responses. Kept open-ended in v1.0; no specific kinds are reserved.
 */
export type PendingMeta = Record<string, unknown>;
