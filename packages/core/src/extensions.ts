import { InvalidRequestError } from "./errors.js";

// ARCP v1.1 extensions are `x-vendor.<vendor>.<name>` per §15 IANA notes.
// The old `arcpx.<vendor>.<name>.v<n>` namespace is gone.

/**
 * Pattern for a vendor extension namespace.
 *
 * `x-vendor.<vendor>.<more dots allowed>`. Lowercase, ASCII letters, digits,
 * hyphens, and underscores in each segment.
 */
const VENDOR_EXTENSION_PATTERN = /^x-vendor(?:\.[a-z0-9_-]+){2,}$/;

/**
 * Template-literal shape of a vendor extension name. Encodes only the
 * `x-vendor.<vendor>.<rest>` prefix; the segment characters are still
 * validated at runtime via `isVendorExtensionName`.
 */
export type VendorExtensionName = `x-vendor.${string}.${string}`;

/** Whether `name` is a syntactically valid `x-vendor.*` extension name. */
export function isVendorExtensionName(
  name: string,
): name is VendorExtensionName {
  return VENDOR_EXTENSION_PATTERN.test(name);
}

/**
 * Closed set of core v1.1 message types. Any other type must be in the
 * `x-vendor.*` namespace.
 */
export const CORE_MESSAGE_TYPES = [
  "session.hello",
  "session.welcome",
  "session.error",
  "session.bye",
  "job.submit",
  "job.accepted",
  "job.cancel",
  "job.event",
  "job.result",
  "job.error",
] as const;
export type CoreMessageType = (typeof CORE_MESSAGE_TYPES)[number];

const CORE_TYPE_SET: ReadonlySet<string> = new Set(CORE_MESSAGE_TYPES);

const CORE_PREFIXES = ["session.", "job."] as const;

/** Whether `type` is one of the ten core ARCP v1.1 message types. */
export function isCoreType(type: string): type is CoreMessageType {
  return CORE_TYPE_SET.has(type);
}

/**
 * Whether `type` is a core type OR uses a reserved core prefix
 * (`session.`/`job.`). Used to distinguish a *typo* from a *vendor
 * extension*: `session.unknown` looks like a core typo, so we error;
 * `x-vendor.foo` is an extension, so we route through
 * {@link classifyUnknownType}.
 */
export function looksLikeCoreType(type: string): boolean {
  if (CORE_TYPE_SET.has(type)) return true;
  return CORE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * Disposition for an inbound message whose `type` is unknown to this receiver.
 *
 * Unknown core-prefixed types and malformed type names produce an
 * `INVALID_REQUEST`. Vendor-prefixed types with the `optional` flag in
 * the envelope's `extensions` map are silently dropped.
 */
export type UnknownTypeDisposition =
  | { kind: "drop"; reason: string }
  | { kind: "error"; code: "INVALID_REQUEST"; reason: string };

/**
 * Decide what to do when we receive an envelope with an unknown `type`.
 *
 *   - Unknown core-prefixed type    → error `INVALID_REQUEST`.
 *   - Vendor extension, optional    → silent drop.
 *   - Vendor extension, required    → error `INVALID_REQUEST`.
 *   - Anything else                 → error `INVALID_REQUEST`.
 */
export function classifyUnknownType(
  type: string,
  options: { extensionsObject?: Record<string, unknown> | undefined } = {},
): UnknownTypeDisposition {
  if (looksLikeCoreType(type)) {
    return {
      kind: "error",
      code: "INVALID_REQUEST",
      reason: `Unknown core message type "${type}"`,
    };
  }
  if (isVendorExtensionName(type)) {
    const optional = options.extensionsObject?.["optional"] === true;
    if (optional) {
      return {
        kind: "drop",
        reason: `Optional vendor extension "${type}" not supported`,
      };
    }
    return {
      kind: "error",
      code: "INVALID_REQUEST",
      reason: `Required vendor extension "${type}" not supported`,
    };
  }
  return {
    kind: "error",
    code: "INVALID_REQUEST",
    reason: `Type "${type}" matches neither core nor vendor extension namespace`,
  };
}

/**
 * Validates an envelope `extensions` object's keys.
 *
 * The reserved key `optional` is allowed bare. Every other key MUST be a
 * valid vendor extension namespace (`x-vendor.<vendor>.<name>`).
 */
export function validateExtensionsObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (key === "optional") continue;
    if (!isVendorExtensionName(key)) {
      throw new InvalidRequestError(
        `Extensions key "${key}" is not a valid namespace; expected "optional" or "x-vendor.<vendor>.<name>"`,
        { details: { key } },
      );
    }
  }
}
