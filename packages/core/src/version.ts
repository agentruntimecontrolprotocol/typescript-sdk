/**
 * Protocol version implemented by this package.
 *
 * Tracks ARCP v1.0 (ARCP v1.0). The `arcp` envelope field is the
 * literal major-version string per §5.1.
 */
export const PROTOCOL_VERSION = "1" as const;

/** Implementation version of this package. Bump on releases. */
export const IMPL_VERSION = "0.1.0" as const;

/**
 * Whether `other` is wire-compatible with this implementation.
 *
 * v1.0 requires `arcp: "1"` literally. No semver tolerance: §5.1 fixes
 * the value as a string discriminator, not a version range.
 */
export function isCompatibleVersion(other: string): boolean {
  return other === PROTOCOL_VERSION;
}
