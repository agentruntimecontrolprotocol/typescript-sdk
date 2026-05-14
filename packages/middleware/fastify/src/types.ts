/**
 * Public type surface for `@arcp/fastify`.
 *
 * Re-exports the `AttachArcpUpgradeOptions` / `ArcpUpgradeHandle` pair from
 * `@arcp/node`: the contract is identical (the Node upgrade event vs the
 * Fastify route is an internal detail).
 */
export type { ArcpUpgradeHandle, AttachArcpUpgradeOptions } from "@arcp/node";
