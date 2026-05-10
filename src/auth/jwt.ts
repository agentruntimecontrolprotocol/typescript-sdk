import { type JWTPayload, type JWTVerifyOptions, jwtVerify, type KeyLike } from "jose";
import { UnauthenticatedError } from "../errors.js";
import type { BearerIdentity } from "./bearer.js";

export type JwtKey = KeyLike | Uint8Array;

/**
 * Verifier for `signed_jwt` (§8.2).
 *
 * Holds a verification key and an optional set of expectations
 * (audience, issuer); validates the token via `jose.jwtVerify`. Returns a
 * {@link BearerIdentity} whose principal is sourced from `sub` (or the
 * configured `principalClaim`).
 */
export class JwtVerifier {
  public constructor(
    private readonly key: JwtKey,
    private readonly options: JWTVerifyOptions & { principalClaim?: string } = {},
  ) {}

  public async verify(token: string): Promise<BearerIdentity> {
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, this.key, this.options);
      payload = result.payload;
    } catch (cause) {
      throw new UnauthenticatedError("Invalid or expired JWT", {
        cause: cause instanceof Error ? cause : undefined,
      });
    }
    const claim = this.options.principalClaim ?? "sub";
    const claimValue = payload[claim];
    if (typeof claimValue !== "string" || claimValue.length === 0) {
      throw new UnauthenticatedError(`JWT missing principal claim "${claim}"`);
    }
    return { principal: claimValue };
  }
}
