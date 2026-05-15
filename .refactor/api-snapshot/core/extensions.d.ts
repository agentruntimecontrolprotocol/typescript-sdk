/**
 * Template-literal shape of a vendor extension name. Encodes only the
 * `x-vendor.<vendor>.<rest>` prefix; the segment characters are still
 * validated at runtime via `isVendorExtensionName`.
 */
export type VendorExtensionName = `x-vendor.${string}.${string}`;
/** Whether `name` is a syntactically valid `x-vendor.*` extension name. */
export declare function isVendorExtensionName(name: string): name is VendorExtensionName;
/**
 * Closed set of core v1.0 message types. Any other type must be in the
 * `x-vendor.*` namespace.
 */
export declare const CORE_MESSAGE_TYPES: readonly ["session.hello", "session.welcome", "session.error", "session.bye", "job.submit", "job.accepted", "job.cancel", "job.event", "job.result", "job.error"];
export type CoreMessageType = (typeof CORE_MESSAGE_TYPES)[number];
/** Whether `type` is one of the ten core ARCP v1.0 message types. */
export declare function isCoreType(type: string): type is CoreMessageType;
/**
 * Whether `type` is a core type OR uses a reserved core prefix
 * (`session.`/`job.`). Used to distinguish a *typo* from a *vendor
 * extension*: `session.unknown` looks like a core typo, so we error;
 * `x-vendor.foo` is an extension, so we route through
 * {@link classifyUnknownType}.
 */
export declare function looksLikeCoreType(type: string): boolean;
/**
 * Disposition for an inbound message whose `type` is unknown to this receiver.
 *
 * Unknown core-prefixed types and malformed type names produce an
 * `INVALID_REQUEST`. Vendor-prefixed types with the `optional` flag in
 * the envelope's `extensions` map are silently dropped.
 */
export type UnknownTypeDisposition = {
    kind: "drop";
    reason: string;
} | {
    kind: "error";
    code: "INVALID_REQUEST";
    reason: string;
};
/**
 * Decide what to do when we receive an envelope with an unknown `type`.
 *
 *   - Unknown core-prefixed type    → error `INVALID_REQUEST`.
 *   - Vendor extension, optional    → silent drop.
 *   - Vendor extension, required    → error `INVALID_REQUEST`.
 *   - Anything else                 → error `INVALID_REQUEST`.
 */
export declare function classifyUnknownType(type: string, options?: {
    extensionsObject?: Record<string, unknown> | undefined;
}): UnknownTypeDisposition;
/**
 * Validates an envelope `extensions` object's keys.
 *
 * The reserved key `optional` is allowed bare. Every other key MUST be a
 * valid vendor extension namespace (`x-vendor.<vendor>.<name>`).
 */
export declare function validateExtensionsObject(obj: Record<string, unknown>): void;
//# sourceMappingURL=extensions.d.ts.map