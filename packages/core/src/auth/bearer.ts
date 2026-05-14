import { UnauthenticatedError } from "../errors.js";

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
 * Bearer-token verifier. Implementers consult their trust store; the protocol
 * leaves issuance up to the deployment per §2 (auth provider implementations
 * are out of scope).
 */
export interface BearerVerifier {
  verify(token: string): Promise<BearerIdentity>;
}

/**
 * In-memory bearer verifier suitable for tests and small deployments. Maps
 * tokens to identities verbatim.
 */
export class StaticBearerVerifier implements BearerVerifier {
  public constructor(
    private readonly tokens: ReadonlyMap<string, BearerIdentity>,
  ) {}

  public async verify(token: string): Promise<BearerIdentity> {
    const identity = this.tokens.get(token);
    if (identity === undefined) {
      throw new UnauthenticatedError("Unknown bearer token");
    }
    return identity;
  }
}
