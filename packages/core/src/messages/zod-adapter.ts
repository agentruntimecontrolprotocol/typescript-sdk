// Effect v3.21.x has no built-in zod interop. This module is the
// one-call escape hatch the remaining zod-typed call-sites in
// `messages/events.ts`, `messages/execution.ts`, and `messages/session.ts`
// use during the in-flight Effect migration (slices #36, #37, #50). Once
// every schema is native Effect `Schema`, this file is removed.
//
// `fromZod(zodSchema)` returns an Effect `Schema.Schema<A>` whose decode
// step delegates to `zodSchema.safeParse` via a `transformOrFail` from
// `Schema.Unknown`. Decode-only — encode is the identity. No transforms,
// no defaults. Sufficient for the bridge consumers in slices #36/#37/#50.

import { ParseResult, Schema } from "effect";
import type { z } from "zod";

/**
 * Wrap a zod schema as an Effect `Schema.Schema<A, unknown>` that defers
 * all validation to `zodSchema.safeParse`.
 *
 * Intended exclusively as a temporary bridge so a heterogeneous map of
 * `{ kind: schema }` entries (some zod, some Effect) can be uniformly
 * consumed. Prefer migrating the underlying schema instead of wrapping it.
 *
 * On parse failure the returned schema raises a `ParseError` carrying the
 * zod issue messages joined by `; ` — sufficient for the test gates and
 * the error-surfacing call sites in `parseJobEventBody`.
 */
export const fromZod = <A>(
  zodSchema: z.ZodType<A>,
): Schema.Schema<A, unknown> => {
  const guard = (input: unknown): input is A =>
    zodSchema.safeParse(input).success;
  return Schema.transformOrFail(Schema.Unknown, Schema.declare<A>(guard), {
    strict: true,
    decode: (input, _options, ast) => {
      const result = zodSchema.safeParse(input);
      if (result.success) {
        return ParseResult.succeed(result.data);
      }
      const message = result.error.issues
        .map(
          (issue) =>
            `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        )
        .join("; ");
      return ParseResult.fail(new ParseResult.Type(ast, input, message));
    },
    encode: (value) => ParseResult.succeed(value),
  });
};
