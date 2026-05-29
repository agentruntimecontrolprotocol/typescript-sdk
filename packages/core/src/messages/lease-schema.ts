import { Schema } from "effect";

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
  /** v1.1 §9.7 — controls which LLM models a job may invoke. */
  "model.use",
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
 * Inferred as a mutable `Record<string, string[]>` so the in-process
 * consumers (`runtime/lease.ts`, `client-handle.ts`, etc.) keep their
 * existing `Lease` contract.
 *
 * Effect's `Schema.Record` silently drops keys that fail the key schema, so a
 * `nonEmptyString` key would make `{ "": [...] }` decode to `{}` rather than
 * fail. To preserve §9.1 reject-on-bad-key semantics we accept any string key
 * and reject empty keys in the filter below, so no requested capability is
 * ever silently discarded.
 */
export const LeaseSchema = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.mutable(
      Schema.Array(Schema.String.pipe(Schema.nonEmptyString())),
    ),
  }),
).pipe(
  Schema.filter((lease) =>
    Object.keys(lease).some((k) => k.length === 0)
      ? "lease capability names MUST be non-empty (§9.1)"
      : undefined,
  ),
);

/**
 * `Lease` is `Record<string, string[]>` for caller compat with the many
 * in-process consumers (`runtime/lease.ts`, `client-handle.ts`, etc.).
 */
export type Lease = Schema.Schema.Type<typeof LeaseSchema>;

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
export type LeaseConstraints = Schema.Schema.Type<
  typeof LeaseConstraintsSchema
>;
