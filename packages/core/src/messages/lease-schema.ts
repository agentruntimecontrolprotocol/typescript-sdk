import { Schema } from "effect";
import { z } from "zod";

/**
 * §9.2 reserved capability namespaces.
 *
 * Any other capability name MUST start with `x-vendor.` per §15. The
 * runtime-side `validateLeaseCapabilityName` enforces this; the wire-shape
 * schema below allows any string and defers validation.
 */
export const RESERVED_CAPABILITY_NAMES = [
  "fs.read",
  "fs.write",
  "net.fetch",
  "tool.call",
  "agent.delegate",
  "cost.budget",
] as const;
export type ReservedCapabilityName = (typeof RESERVED_CAPABILITY_NAMES)[number];

/** Whether `name` is a v1.0 reserved capability namespace. */
export function isReservedCapabilityName(
  name: string,
): name is ReservedCapabilityName {
  return (RESERVED_CAPABILITY_NAMES as readonly string[]).includes(name);
}

/** Whether `name` is a syntactically valid v1.0 capability name. */
export function isValidCapabilityName(name: string): boolean {
  if (isReservedCapabilityName(name)) return true;
  // x-vendor.<vendor>.<capability> per §15.
  return /^x-vendor(\.[a-z0-9_-]+){2,}$/.test(name);
}

/**
 * §9.1 lease (Effect Schema): capability → list of glob patterns.
 *
 * Native Effect surface for in-process consumers. The zod twin
 * {@link LeaseZodSchema} still feeds `messageEnvelope()` (slice #50).
 *
 * Effect's `Schema.Record` silently drops keys that fail the key schema, so
 * `{ "": [...] }` decodes to `{}`. The zod twin rejects empty keys at the
 * wire layer where it counts.
 */
export const LeaseSchema = Schema.Record({
  key: Schema.String.pipe(Schema.nonEmptyString()),
  value: Schema.Array(Schema.String.pipe(Schema.nonEmptyString())),
});

/** §9.1 lease (zod twin) — drives the zod-typed envelope wrappers. */
export const LeaseZodSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)),
);
/**
 * `Lease` is the zod-inferred type so it stays structurally equivalent to
 * `Record<string, string[]>` for the many in-process consumers
 * (`runtime/lease.ts`, `client-handle.ts`, etc.). The Effect schema infers a
 * `ReadonlyArray<string>` value which would be a non-trivial breaking change
 * to callers — defer that to slice #50.
 */
export type Lease = z.infer<typeof LeaseZodSchema>;

/**
 * v1.1 §9.5 lease constraints (Effect Schema). Currently carries only
 * `expires_at` (ISO 8601 UTC with `Z` suffix), which sets a hard upper bound
 * on the lease's lifetime.
 *
 * The schema validates `expires_at` is a non-empty string. Stricter checks
 * (UTC, future-dated) are enforced at submit time by the runtime.
 */
export const LeaseConstraintsSchema = Schema.Struct({
  expires_at: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
});

/** v1.1 §9.5 lease constraints (zod twin). */
export const LeaseConstraintsZodSchema = z.object({
  expires_at: z.string().min(1).optional(),
});
export type LeaseConstraints = z.infer<typeof LeaseConstraintsZodSchema>;
