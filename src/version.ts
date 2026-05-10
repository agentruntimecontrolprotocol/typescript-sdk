/**
 * Protocol version implemented by this package.
 *
 * Tracks RFC 0001 v2. The major component governs wire compatibility.
 * @see RFC-0001-v2.md §6.1.1 (`arcp` envelope field).
 */
export const PROTOCOL_VERSION = "1.0" as const;

/** Implementation version of this package. Bump on releases. */
export const IMPL_VERSION = "0.1.0" as const;

/**
 * Whether `other` is wire-compatible with this implementation.
 *
 * v0.1 accepts any envelope whose `arcp` major version equals our own.
 * @see PLAN.md §4 open question 1.
 */
export function isCompatibleVersion(other: string): boolean {
  const ours = PROTOCOL_VERSION.split(".")[0];
  const theirs = other.split(".")[0];
  return ours === theirs && ours !== undefined && ours !== "";
}
