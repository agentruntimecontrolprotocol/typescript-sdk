import type { Effect } from "effect";

import type { TaggedUnauthenticated } from "../errors-tagged.js";

/**
 * Outcome of authenticating a bearer credential. The runtime uses the
 * principal to scope identity; entitlements drive subscription authorization.
 */
export interface BearerIdentity {
  principal: string;
  entitlements?: {
    sessions?: readonly string[];
    traces?: readonly string[];
  };
}

/**
 * Bearer-token verifier (legacy Promise-shaped). Implementers consult their
 * trust store; the protocol leaves issuance up to the deployment per §2 (auth
 * provider implementations are out of scope).
 *
 * Retained as a published interface so existing consumers (including
 * `examples/custom-auth`) continue to compile. Effect-native consumers should
 * prefer `BearerVerifierEffect` and `BearerVerifierService` from
 * `./bearer.js`.
 */
export interface BearerVerifier {
  verify(token: string): Promise<BearerIdentity>;
}

/**
 * Effect-shaped verifier surface. The `verify` method returns an Effect that
 * fails with `TaggedUnauthenticated` when the token is unknown or invalid.
 * Used as the operational shape of `BearerVerifierService`.
 */
export interface BearerVerifierEffect {
  readonly verify: (
    token: string,
  ) => Effect.Effect<BearerIdentity, TaggedUnauthenticated>;
}
