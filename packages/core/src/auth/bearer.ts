import { UnauthenticatedError } from "../errors.js";

import type { BearerIdentity, BearerVerifier } from "./types.js";

/**
 * In-memory bearer verifier suitable for tests and small deployments. Maps
 * tokens to identities verbatim.
 */
export class StaticBearerVerifier implements BearerVerifier {
  public constructor(
    private readonly tokens: ReadonlyMap<string, BearerIdentity>,
  ) {}

  // Synchronous lookup, but `BearerVerifier.verify` is contractually async so
  // alternative implementations can be backed by JWKS/HTTP.
  // eslint-disable-next-line @typescript-eslint/require-await
  public async verify(token: string): Promise<BearerIdentity> {
    const identity = this.tokens.get(token);
    if (identity === undefined) {
      throw new UnauthenticatedError("Unknown bearer token");
    }
    return identity;
  }
}
