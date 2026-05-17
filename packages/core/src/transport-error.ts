/* eslint-disable unicorn/throw-new-error -- Schema.TaggedError factory, not `throw new Error` */
// Transport failures below the ARCP protocol layer. Kept separate from
// `errors-tagged.ts` (which imports legacy `ARCPError` classes) so
// cross-package callers can construct `TaggedTransportError` without pulling
// the full tagged-error graph or hitting circular type resolution.

import { Schema } from "effect";

/**
 * Transport-layer failure surfaced through Effect's typed-error channel.
 *
 * Not part of the §12 ARCP error catalog. Effect-shaped transports fail their
 * `incoming` stream and `send` Effect with this error.
 */
export class TaggedTransportError extends Schema.TaggedError<TaggedTransportError>()(
  "TransportError",
  {
    cause: Schema.Defect,
    kind: Schema.optional(Schema.String),
  },
) {}

/** Build a send-path transport failure. */
export function transportSendError(cause: unknown): TaggedTransportError {
  return new TaggedTransportError({ cause, kind: "send" });
}
