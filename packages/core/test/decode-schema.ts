import { Effect, Schema } from "effect";

/** Async `decodeUnknown` for schema round-trip tests. */
export const decode =
  <S extends Schema.Schema.AnyNoContext>(schema: S) =>
  (input: unknown): Promise<Schema.Schema.Type<S>> =>
    Effect.runPromise(Schema.decodeUnknown(schema)(input));
