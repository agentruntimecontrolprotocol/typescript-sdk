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

/** §9.1 lease: capability → list of glob patterns. */
export const LeaseSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)),
);
export type Lease = z.infer<typeof LeaseSchema>;

/**
 * v1.1 §9.5 lease constraints. Currently carries only `expires_at` (ISO 8601
 * UTC with `Z` suffix), which sets a hard upper bound on the lease's lifetime.
 *
 * The schema validates `expires_at` is a non-empty string. Stricter checks
 * (UTC, future-dated) are enforced at submit time by the runtime.
 */
export const LeaseConstraintsSchema = z.object({
  expires_at: z.string().min(1).optional(),
});
export type LeaseConstraints = z.infer<typeof LeaseConstraintsSchema>;
