import { Schema } from "effect";

// ARCP v1.0 §8.2 — `artifact_ref` event kind body shape only. There is no
// top-level artifact envelope in v1.0; agents emit a `job.event` with
// `kind = "artifact_ref"` and the body shape below.

/**
 * §8.2 `artifact_ref` event-kind body — Effect `Schema` definition.
 *
 * Behavior parity with the legacy zod schema is preserved field-for-field:
 *   - `uri`, `content_type` are non-empty strings.
 *   - `byte_size` is an optional non-negative integer.
 *   - `sha256` is an optional string (no length floor in v1.0).
 *
 * Use `Schema.decodeUnknownSync(ArtifactRefSchema)(x)` to validate inbound
 * JSON (throws `ParseError` on bad input, matching the throw semantics of
 * the legacy `ArtifactRefZodSchema.parse(x)` call site).
 */
export const ArtifactRefSchema = Schema.Struct({
  uri: Schema.String.pipe(Schema.nonEmptyString()),
  content_type: Schema.String.pipe(Schema.nonEmptyString()),
  byte_size: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ),
  sha256: Schema.optional(Schema.String),
});
export type ArtifactRef = Schema.Schema.Type<typeof ArtifactRefSchema>;

/** No top-level artifact envelopes in v1.0. */
export const ARTIFACT_ENVELOPES = [] as const;
