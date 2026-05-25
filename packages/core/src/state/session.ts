import { Effect, SynchronizedRef } from "effect";

import type { BearerIdentity } from "../auth/types.js";
import type { SessionId } from "../brands.js";
import {
  TaggedInvalidRequest,
  TaggedUnauthenticated,
} from "../errors-tagged.js";
import { InvalidRequestError, UnauthenticatedError } from "../errors.js";
import type { Capabilities } from "../messages/types.js";

import type { SessionPhase, SessionSnapshot } from "./types.js";

// ARCP v1.1 session lifecycle. Phases:
//
//   opening   — pre-welcome
//   accepted  — post-welcome, live
//   closing   — `session.bye` in flight
//   rejected  — `session.error` (terminal)

const VALID_TRANSITIONS = {
  opening: new Set<SessionPhase>(["accepted", "rejected"]),
  accepted: new Set<SessionPhase>(["closing"]),
  closing: new Set<SessionPhase>(),
  rejected: new Set<SessionPhase>(),
} as const satisfies Record<SessionPhase, ReadonlySet<SessionPhase>>;

/**
 * Internal mutable record backing both the legacy {@link SessionState} class
 * and the Effect-shaped {@link SessionStateService}. Kept here so the two
 * surfaces share the same field layout and the legacy class can thin-wrap
 * the snapshot helpers below.
 */
interface SessionStateInternals {
  phase: SessionPhase;
  id: SessionId | undefined;
  identity: BearerIdentity | undefined;
  capabilities: Capabilities | undefined;
}

function initialInternals(): SessionStateInternals {
  return {
    phase: "opening",
    id: undefined,
    identity: undefined,
    capabilities: undefined,
  };
}

function snapshotOf(s: SessionStateInternals): SessionSnapshot {
  return {
    id: s.id,
    phase: s.phase,
    identity: s.identity,
    capabilities: s.capabilities,
  };
}

function transitionInternals(
  s: SessionStateInternals,
  next: SessionPhase,
): SessionStateInternals {
  const allowed = VALID_TRANSITIONS[s.phase];
  if (!allowed.has(next)) {
    throw new InvalidRequestError(
      `Illegal session transition: ${s.phase} → ${next}`,
      { details: { from: s.phase, to: next } },
    );
  }
  return { ...s, phase: next };
}

function assignIdInternals(
  s: SessionStateInternals,
  id: SessionId,
): SessionStateInternals {
  if (s.id !== undefined && s.id !== id) {
    throw new InvalidRequestError("session_id already assigned");
  }
  return { ...s, id };
}

/**
 * Mutable session state managed by the runtime/client. Tracks the §6 phase
 * machine and the negotiated capabilities.
 *
 * Illegal transitions throw {@link InvalidRequestError}.
 *
 * Thin-wraps the same {@link SessionStateInternals} record consumed by
 * {@link SessionStateService}; the class surface stays for non-Effect
 * callers (runtime/client) while Effect-aware code reaches for the service.
 */
export class SessionState {
  private internals: SessionStateInternals = initialInternals();

  public get phase(): SessionPhase {
    return this.internals.phase;
  }
  public get id(): SessionId | undefined {
    return this.internals.id;
  }
  public get identity(): BearerIdentity | undefined {
    return this.internals.identity;
  }
  public get capabilities(): Capabilities | undefined {
    return this.internals.capabilities;
  }
  public get isAccepted(): boolean {
    return this.internals.phase === "accepted";
  }

  public transition(next: SessionPhase): void {
    this.internals = transitionInternals(this.internals, next);
  }

  public assignId(id: SessionId): void {
    this.internals = assignIdInternals(this.internals, id);
  }

  public assignIdentity(identity: BearerIdentity): void {
    this.internals = { ...this.internals, identity };
  }

  public assignCapabilities(caps: Capabilities): void {
    this.internals = { ...this.internals, capabilities: caps };
  }

  /** Throw if the session has not advanced to `accepted` (§6). */
  public requireAccepted(): void {
    if (!this.isAccepted) {
      throw new UnauthenticatedError(
        `Session not accepted yet (phase=${this.internals.phase}); pre-handshake traffic rejected`,
      );
    }
  }

  public snapshot(): SessionSnapshot {
    return snapshotOf(this.internals);
  }
}

/**
 * Effect-shaped twin of {@link SessionState}. Backs the mutable phase machine
 * with a {@link SynchronizedRef} so concurrent fibers can call `transition`,
 * `assignId`, etc. without trampling each other. Phase validity rules and
 * `session_id` re-assignment guards match the legacy class byte-for-byte;
 * violations surface as {@link TaggedInvalidRequest} on the typed-error
 * channel rather than thrown {@link InvalidRequestError}.
 *
 * Use {@link SessionStateService.Default} to inject a fresh session.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const state = yield* SessionStateService
 *   yield* state.assignId(id)
 *   yield* state.transition("accepted")
 *   return yield* state.snapshot
 * }).pipe(Effect.provide(SessionStateService.Default))
 * ```
 */
export class SessionStateService extends Effect.Service<SessionStateService>()(
  "arcp/SessionStateService",
  {
    effect: Effect.gen(function* () {
      const ref =
        yield* SynchronizedRef.make<SessionStateInternals>(initialInternals());
      return makeSessionStateOps(ref);
    }),
  },
) {}

type SessionRef = SynchronizedRef.SynchronizedRef<SessionStateInternals>;

function transitionEffect(
  ref: SessionRef,
  next: SessionPhase,
): Effect.Effect<void, TaggedInvalidRequest> {
  return SynchronizedRef.updateEffect(ref, (s) => {
    const allowed = VALID_TRANSITIONS[s.phase];
    if (!allowed.has(next)) {
      return Effect.fail(
        new TaggedInvalidRequest({
          message: `Illegal session transition: ${s.phase} → ${next}`,
          details: { from: s.phase, to: next },
        }),
      );
    }
    return Effect.succeed({ ...s, phase: next });
  });
}

function assignIdEffect(
  ref: SessionRef,
  id: SessionId,
): Effect.Effect<void, TaggedInvalidRequest> {
  return SynchronizedRef.updateEffect(ref, (s) => {
    if (s.id !== undefined && s.id !== id) {
      return Effect.fail(
        new TaggedInvalidRequest({
          message: "session_id already assigned",
        }),
      );
    }
    return Effect.succeed({ ...s, id });
  });
}

function requireAcceptedEffect(
  ref: SessionRef,
): Effect.Effect<void, TaggedUnauthenticated> {
  return SynchronizedRef.get(ref).pipe(
    Effect.flatMap((s) =>
      s.phase === "accepted"
        ? Effect.void
        : Effect.fail(
            new TaggedUnauthenticated({
              message: `Session not accepted yet (phase=${s.phase}); pre-handshake traffic rejected`,
            }),
          ),
    ),
  );
}

function makeSessionStateOps(ref: SessionRef) {
  return {
    snapshot: SynchronizedRef.get(ref).pipe(Effect.map(snapshotOf)),
    transition: (next: SessionPhase) => transitionEffect(ref, next),
    assignId: (id: SessionId) => assignIdEffect(ref, id),
    assignIdentity: (identity: BearerIdentity): Effect.Effect<void> =>
      SynchronizedRef.update(ref, (s) => ({ ...s, identity })),
    assignCapabilities: (caps: Capabilities): Effect.Effect<void> =>
      SynchronizedRef.update(ref, (s) => ({ ...s, capabilities: caps })),
    requireAccepted: requireAcceptedEffect(ref),
  } as const;
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
  const c: Capabilities = client ?? {};
  const out: Capabilities = {};
  applyEncodings(out, c, runtime);
  applyAgents(out, runtime);
  applyFeatures(out, c, runtime);
  applyVendorKeys(out, c, runtime);
  return out;
}

const KNOWN_CAPABILITY_KEYS: ReadonlySet<string> = new Set([
  "encodings",
  "agents",
  "features",
]);

function applyEncodings(
  out: Capabilities,
  client: Capabilities,
  runtime: Capabilities,
): void {
  const clientEncodings = Array.isArray(client.encodings)
    ? client.encodings
    : undefined;
  const runtimeEncodings = Array.isArray(runtime.encodings)
    ? runtime.encodings
    : undefined;
  if (clientEncodings !== undefined && runtimeEncodings !== undefined) {
    out.encodings = clientEncodings.filter((e) => runtimeEncodings.includes(e));
    return;
  }
  out.encodings = clientEncodings ?? runtimeEncodings;
}

function applyAgents(out: Capabilities, runtime: Capabilities): void {
  // Runtime owns the agent inventory; client never advertises agents.
  if (Array.isArray(runtime.agents)) {
    out.agents = runtime.agents;
  }
}

function applyFeatures(
  out: Capabilities,
  client: Capabilities,
  runtime: Capabilities,
): void {
  // v1.1 §6.2 — runtime is authoritative for advertised features; the
  // welcome MUST advertise only what is in both lists.
  const clientFeatures = Array.isArray(client.features)
    ? client.features
    : undefined;
  const runtimeFeatures = Array.isArray(runtime.features)
    ? runtime.features
    : undefined;
  if (clientFeatures !== undefined && runtimeFeatures !== undefined) {
    out.features = runtimeFeatures.filter((f) => clientFeatures.includes(f));
    return;
  }
  if (runtimeFeatures !== undefined) {
    out.features = runtimeFeatures;
  } else if (clientFeatures !== undefined) {
    out.features = clientFeatures;
  }
}

function applyVendorKeys(
  out: Capabilities,
  client: Capabilities,
  runtime: Capabilities,
): void {
  for (const k of Object.keys(client)) {
    if (KNOWN_CAPABILITY_KEYS.has(k)) continue;
    (out as Record<string, unknown>)[k] = (client as Record<string, unknown>)[
      k
    ];
  }
  for (const k of Object.keys(runtime)) {
    if (KNOWN_CAPABILITY_KEYS.has(k)) continue;
    if (!(k in out)) {
      (out as Record<string, unknown>)[k] = (
        runtime as Record<string, unknown>
      )[k];
    }
  }
}
