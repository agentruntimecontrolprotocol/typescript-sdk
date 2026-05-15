import { z } from "zod";

import { ErrorPayloadSchema } from "../errors.js";

import { LeaseConstraintsSchema, LeaseSchema } from "./lease-schema.js";
import { LogPayloadSchema, MetricPayloadSchema } from "./telemetry.js";

export const RESERVED_EVENT_KINDS = [
  "log",
  "thought",
  "tool_call",
  "tool_result",
  "status",
  "metric",
  "artifact_ref",
  "delegate",
  // v1.1 §8.2
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

const ThoughtBodySchema = z.object({
  text: z.string(),
});

const ToolCallBodySchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  call_id: z.string().min(1),
});

const ToolResultBodySchema = z
  .object({
    call_id: z.string().min(1),
    result: z.unknown().optional(),
    error: ErrorPayloadSchema.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.result === undefined && b.error === undefined) {
      // empty result for void tools is allowed
      return;
    }
    if (b.result !== undefined && b.error !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool_result body must not carry both `result` and `error`",
      });
    }
  });

const StatusBodySchema = z.object({
  phase: z.string().min(1),
  message: z.string().optional(),
});

const ArtifactRefBodySchema = z.object({
  uri: z.string().min(1),
  content_type: z.string().min(1),
  byte_size: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
});

const DelegateBodySchema = z.object({
  delegate_id: z.string().min(1),
  agent: z.string().min(1),
  input: z.unknown(),
  lease_request: LeaseSchema.optional(),
  /** v1.1 §9.4/§9.5 — child lease bound; MUST NOT exceed parent's. */
  lease_constraints: LeaseConstraintsSchema.optional(),
});

/**
 * v1.1 §8.2.1 `progress` body.
 *
 * `current` MUST be non-negative; `total` (if present) is the upper bound.
 * Advisory; the protocol does not act on progress events.
 */
export const ProgressBodySchema = z.object({
  current: z.number().nonnegative(),
  total: z.number().nonnegative().optional(),
  units: z.string().min(1).optional(),
  message: z.string().optional(),
});
export type ProgressBody = z.infer<typeof ProgressBodySchema>;

/**
 * v1.1 §8.4 `result_chunk` body. Chunks for one `result_id` are emitted in
 * order; `more: false` marks the final chunk. The terminating `job.result`
 * MUST carry `result_id`.
 */
export const ResultChunkBodySchema = z.object({
  result_id: z.string().min(1),
  chunk_seq: z.number().int().nonnegative(),
  data: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  more: z.boolean(),
});
export type ResultChunkBody = z.infer<typeof ResultChunkBodySchema>;

/**
 * Job event payload shape. `kind` is one of the eight reserved values OR a
 * vendor-prefixed string. `body` is validated when the kind matches a
 * reserved schema; vendor and unknown kinds get a permissive object body.
 */
export const JobEventPayloadSchema = z.object({
  kind: z.string().min(1),
  ts: z.string().min(1),
  body: z.unknown(),
});
export type JobEventPayload = z.infer<typeof JobEventPayloadSchema>;

export type LogBody = z.infer<typeof LogPayloadSchema>;
export type ThoughtBody = z.infer<typeof ThoughtBodySchema>;
export type ToolCallBody = z.infer<typeof ToolCallBodySchema>;
export type ToolResultBody = z.infer<typeof ToolResultBodySchema>;
export type StatusBody = z.infer<typeof StatusBodySchema>;
export type MetricBody = z.infer<typeof MetricPayloadSchema>;
export type ArtifactRefBody = z.infer<typeof ArtifactRefBodySchema>;
export type DelegateBody = z.infer<typeof DelegateBodySchema>;

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

// Exhaustiveness guard: every ReservedEventKind member MUST have a schema
// entry below. Adding a new kind to RESERVED_EVENT_KINDS without extending
// this map is a compile-time error (the `satisfies` clause enforces it).
const RESERVED_EVENT_SCHEMAS = {
  log: LogPayloadSchema,
  thought: ThoughtBodySchema,
  tool_call: ToolCallBodySchema,
  tool_result: ToolResultBodySchema,
  status: StatusBodySchema,
  metric: MetricPayloadSchema,
  artifact_ref: ArtifactRefBodySchema,
  delegate: DelegateBodySchema,
  progress: ProgressBodySchema,
  result_chunk: ResultChunkBodySchema,
} as const satisfies Record<ReservedEventKind, z.ZodTypeAny>;

function parseReservedEventBody<K extends ReservedEventKind>(
  kind: K,
  body: unknown,
): ReservedEventBodyMap[K] {
  const schema = RESERVED_EVENT_SCHEMAS[kind];
  return schema.parse(body) as ReservedEventBodyMap[K];
}

/**
 * Parse a `job.event.payload.body` against the kind-specific schema.
 *
 * Reserved kinds (§8.2) are validated against their schemas via the
 * exhaustively-checked {@link parseReservedEventBody}; vendor (`x-vendor.*`)
 * and unknown kinds pass through unchanged (caller MUST treat them as
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
