import { Effect, Layer, Option } from "effect";

import { TaggedUnauthenticated } from "../errors-tagged.js";
import { UnauthenticatedError } from "../errors.js";

import type {
  BearerIdentity,
  BearerVerifier,
  BearerVerifierEffect,
} from "./types.js";

/**
 * In-memory bearer verifier suitable for tests and small deployments. Maps
 * tokens to identities verbatim.
 *
 * Legacy Promise-shaped surface — preserved so consumers that instantiate
 * `new StaticBearerVerifier(new Map([...]))` keep compiling. Effect-native
 * callers should use {@link staticBearerVerifierLayer} or
 * {@link BearerVerifierService} instead.
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

/**
 * Effect-native bearer verifier service. The default provider rejects every
 * token with `TaggedUnauthenticated` — replace it via
 * {@link staticBearerVerifierLayer} or a user-supplied `Layer.succeed`
 * (e.g. for JOSE / JWKS-backed verification).
 *
 * @example
 * ```ts
 * const layer = staticBearerVerifierLayer(
 *   new Map([["tok-good", { principal: "alice" }]]),
 * )
 * const program = Effect.gen(function* () {
 *   const v = yield* BearerVerifierService
 *   return yield* v.verify("tok-good")
 * }).pipe(Effect.provide(layer))
 * ```
 */
export class BearerVerifierService extends Effect.Service<BearerVerifierService>()(
  "arcp/BearerVerifierService",
  {
    succeed: {
      verify: (
        _token: string,
      ): Effect.Effect<BearerIdentity, TaggedUnauthenticated> =>
        Effect.fail(
          new TaggedUnauthenticated({
            message: "no bearer verifier configured",
          }),
        ),
    } satisfies BearerVerifierEffect,
  },
) {}

/**
 * Build a {@link BearerVerifierService} layer backed by a static token →
 * identity table. Equivalent of `new StaticBearerVerifier(table)` for
 * Effect-shaped pipelines.
 */
export function staticBearerVerifierLayer(
  table: ReadonlyMap<string, BearerIdentity>,
): Layer.Layer<BearerVerifierService> {
  const impl: BearerVerifierEffect = {
    verify: (token) =>
      Option.fromNullable(table.get(token)).pipe(
        Effect.mapError(
          () => new TaggedUnauthenticated({ message: "Unknown bearer token" }),
        ),
      ),
  };
  return Layer.succeed(BearerVerifierService, BearerVerifierService.make(impl));
}
