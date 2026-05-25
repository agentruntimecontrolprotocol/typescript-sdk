import { Schema } from "effect";

import { ERROR_CODES, retryabilityViolation } from "../errors.js";

import { ArtifactRefSchema } from "./artifacts.js";
import { LeaseConstraintsSchema } from "./lease-schema.js";
import { LogPayloadSchema, MetricPayloadSchema } from "./telemetry.js";

// ARCP v1.1 §8 / §8.2 / §8.4 — `job.event` body schemas.
//
// This module owns the per-kind body schemas and the `parseJobEventBody`
// dispatch over the reserved-kind set. Bodies for `log`, `metric`, and
// `artifact_ref` are imported from their owning modules (slice #35 migrated
// them); the remaining bodies are defined here as native Effect `Schema`.

export const RESERVED_EVENT_KINDS = [
  "log",
  "thought",
  "tool_call",
  "tool_result",
  "status",
  "metric",
  "artifact_ref",
  "delegate",
  // v1.1 §8.2.1 / §8.4
  "progress",
  "result_chunk",
] as const;
export type ReservedEventKind = (typeof RESERVED_EVENT_KINDS)[number];

export function isReservedEventKind(value: string): value is ReservedEventKind {
  return (RESERVED_EVENT_KINDS as readonly string[]).includes(value);
}

export function isVendorEventKind(value: string): boolean {
  return /^x-vendor\.[a-z0-9_.-]+$/.test(value);
}

// Internal Effect mirror of `ErrorPayloadSchema` (zod, in `errors.ts`).
// Used by the `tool_result` body where the optional `error` field carries
// a §12 error payload. Field-for-field equivalent.
const ErrorPayloadEffectSchema = Schema.Struct({
  code: Schema.Literal(...ERROR_CODES),
  message: Schema.String.pipe(Schema.nonEmptyString()),
  retryable: Schema.Boolean,
  details: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
}).pipe(Schema.filter((p) => retryabilityViolation(p.code, p.retryable)));

/** §8.2 `thought` event-kind body. */
export const ThoughtBodySchema = Schema.Struct({
  text: Schema.String,
});
export type ThoughtBody = Schema.Schema.Type<typeof ThoughtBodySchema>;

/** §8.2 `tool_call` event-kind body. */
export const ToolCallBodySchema = Schema.Struct({
  tool: Schema.String.pipe(Schema.nonEmptyString()),
  args: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  call_id: Schema.String.pipe(Schema.nonEmptyString()),
});
export type ToolCallBody = Schema.Schema.Type<typeof ToolCallBodySchema>;

/**
 * §8.2 `tool_result` event-kind body.
 *
 * Carries either `result` (success) or `error` (failure) but not both. An
 * empty body (neither field) is allowed for void tools. The mutual exclusion
 * is enforced via `Schema.filter` (zod parity: `superRefine`).
 */
export const ToolResultBodySchema = Schema.Struct({
  call_id: Schema.String.pipe(Schema.nonEmptyString()),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(ErrorPayloadEffectSchema),
}).pipe(
  Schema.filter((b) =>
    b.result !== undefined && b.error !== undefined
      ? "tool_result body must not carry both `result` and `error`"
      : undefined,
  ),
);
export type ToolResultBody = Schema.Schema.Type<typeof ToolResultBodySchema>;

/** §8.2 `status` event-kind body. */
export const StatusBodySchema = Schema.Struct({
  phase: Schema.String.pipe(Schema.nonEmptyString()),
  message: Schema.optional(Schema.String),
});
export type StatusBody = Schema.Schema.Type<typeof StatusBodySchema>;

// `LeaseSchema` in `lease-schema.ts` infers
// `Record<string, ReadonlyArray<string>>`; the rest of the runtime (lease.ts,
// job-runner.ts) treats `Lease` as the mutable `Record<string, string[]>`
// shape from the zod twin. Define a native Effect mirror that wraps the
// inner array in `Schema.mutable` and applies `Schema.mutable` to the record
// so the inferred `DelegateBody.lease_request` stays assignment-compatible
// with the zod-derived `Lease` alias used across the runtime.
const LeaseMutableEffectSchema = Schema.mutable(
  Schema.Record({
    key: Schema.String.pipe(Schema.nonEmptyString()),
    value: Schema.mutable(
      Schema.Array(Schema.String.pipe(Schema.nonEmptyString())),
    ),
  }),
);

/** §8.2 `delegate` event-kind body. */
export const DelegateBodySchema = Schema.Struct({
  delegate_id: Schema.String.pipe(Schema.nonEmptyString()),
  agent: Schema.String.pipe(Schema.nonEmptyString()),
  input: Schema.Unknown,
  lease_request: Schema.optional(LeaseMutableEffectSchema),
  /** v1.1 §9.4/§9.5 — child lease bound; MUST NOT exceed parent's. */
  lease_constraints: Schema.optional(LeaseConstraintsSchema),
}) satisfies Schema.Schema.AnyNoContext;
export type DelegateBody = Schema.Schema.Type<typeof DelegateBodySchema>;

/**
 * v1.1 §8.2.1 `progress` body.
 *
 * `current` MUST be non-negative; `total` (if present) is the upper bound.
 * Advisory; the protocol does not act on progress events.
 */
export const ProgressBodySchema = Schema.Struct({
  current: Schema.Number.pipe(Schema.nonNegative()),
  total: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
  units: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  message: Schema.optional(Schema.String),
}).pipe(
  Schema.filter((p) =>
    p.total !== undefined && p.current > p.total
      ? "progress.current must not exceed progress.total"
      : undefined,
  ),
);
export type ProgressBody = Schema.Schema.Type<typeof ProgressBodySchema>;

/**
 * v1.1 §8.4 `result_chunk` body. Chunks for one `result_id` are emitted in
 * order; `more: false` marks the final chunk. The terminating `job.result`
 * MUST carry `result_id`.
 */
export const ResultChunkBodySchema = Schema.Struct({
  result_id: Schema.String.pipe(Schema.nonEmptyString()),
  chunk_seq: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  data: Schema.String,
  encoding: Schema.Literal("utf8", "base64"),
  more: Schema.Boolean,
});
export type ResultChunkBody = Schema.Schema.Type<typeof ResultChunkBodySchema>;

// Re-exported body type aliases for the telemetry + artifact bodies, so
// `messages/types.ts` keeps a single import path for the body type surface.
export type LogBody = Schema.Schema.Type<typeof LogPayloadSchema>;
export type MetricBody = Schema.Schema.Type<typeof MetricPayloadSchema>;
export type ArtifactRefBody = Schema.Schema.Type<typeof ArtifactRefSchema>;

/**
 * Job event payload shape (top-level `payload` for `job.event` envelopes).
 *
 * `kind` is one of the eight v1.0 reserved values, one of the two v1.1
 * additions, OR a vendor-prefixed string. `body` is `unknown` at the
 * envelope layer; reserved kinds are validated against their specific
 * schemas via {@link parseJobEventBody}; vendor (`x-vendor.*`) and unknown
 * kinds pass through unchanged (caller MUST treat them as opaque per §15).
 */
export const JobEventPayloadSchema = Schema.Struct({
  kind: Schema.String.pipe(Schema.nonEmptyString()),
  ts: Schema.String.pipe(Schema.nonEmptyString()),
  body: Schema.Unknown,
});

export type JobEventPayload = Schema.Schema.Type<typeof JobEventPayloadSchema>;

/**
 * Map a reserved event kind to its strongly-typed body.
 *
 * Used by {@link parseJobEventBody} to ensure compile-time exhaustiveness
 * over the v1.0 + v1.1 reserved set (§8.2). Adding a new reserved kind
 * without updating this map (and the matching `parseReservedEventBody`
 * case) is a type error.
 */
export interface ReservedEventBodyMap {
  log: LogBody;
  thought: ThoughtBody;
  tool_call: ToolCallBody;
  tool_result: ToolResultBody;
  status: StatusBody;
  metric: MetricBody;
  artifact_ref: ArtifactRefBody;
  delegate: DelegateBody;
  progress: ProgressBody;
  result_chunk: ResultChunkBody;
}

// Per-kind sync decoders, keyed by reserved kind. `Schema.decodeUnknownSync`
// throws a `ParseError` on bad input — matches the throw semantics of the
// legacy `zodSchema.parse(body)` call site.
//
// `satisfies Record<ReservedEventKind, ...>` is the exhaustiveness guard:
// adding a new kind to `RESERVED_EVENT_KINDS` without a corresponding
// decoder here is a compile-time error.
const RESERVED_EVENT_DECODERS = {
  log: Schema.decodeUnknownSync(LogPayloadSchema),
  thought: Schema.decodeUnknownSync(ThoughtBodySchema),
  tool_call: Schema.decodeUnknownSync(ToolCallBodySchema),
  tool_result: Schema.decodeUnknownSync(ToolResultBodySchema),
  status: Schema.decodeUnknownSync(StatusBodySchema),
  metric: Schema.decodeUnknownSync(MetricPayloadSchema),
  artifact_ref: Schema.decodeUnknownSync(ArtifactRefSchema),
  delegate: Schema.decodeUnknownSync(DelegateBodySchema),
  progress: Schema.decodeUnknownSync(ProgressBodySchema),
  result_chunk: Schema.decodeUnknownSync(ResultChunkBodySchema),
} as const satisfies Record<
  ReservedEventKind,
  (body: unknown) => ReservedEventBodyMap[ReservedEventKind]
>;

function parseReservedEventBody<K extends ReservedEventKind>(
  kind: K,
  body: unknown,
): ReservedEventBodyMap[K] {
  // The per-kind decoder return type is the union of all body types; cast
  // back to the discriminated branch keyed by `K`.
  const decode = RESERVED_EVENT_DECODERS[kind];
  return decode(body) as ReservedEventBodyMap[K];
}

/**
 * Parse a `job.event.payload.body` against the kind-specific schema.
 *
 * Reserved kinds (§8.2) are validated against their schemas via the
 * exhaustively-checked {@link parseReservedEventBody}; vendor (`x-vendor.*`)
 * and unknown kinds pass through unchecked (caller MUST treat them as
 * opaque per §15).
 */
export function parseJobEventBody<K extends ReservedEventKind>(
  kind: K,
  body: unknown,
): ReservedEventBodyMap[K];
export function parseJobEventBody(kind: string, body: unknown): unknown;
export function parseJobEventBody(kind: string, body: unknown): unknown {
  if (isReservedEventKind(kind)) {
    return parseReservedEventBody(kind, body);
  }
  // Vendor (`x-vendor.*`) or unknown kind — pass through unchecked.
  return body;
}
