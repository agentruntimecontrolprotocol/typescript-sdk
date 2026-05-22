/**
 * Public type surface for `@agentruntimecontrolprotocol/fastify`.
 *
 * Re-exports the `AttachArcpUpgradeOptions` / `ArcpUpgradeHandle` pair from
 * `@agentruntimecontrolprotocol/node`: the contract is identical (the Node upgrade event vs the
 * Fastify route is an internal detail).
 */
export type { ArcpUpgradeHandle, AttachArcpUpgradeOptions } from "@agentruntimecontrolprotocol/node";
