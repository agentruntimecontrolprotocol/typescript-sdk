import {
  InvalidRequestError,
  LeaseSubsetViolationError,
  PermissionDeniedError,
} from "@arcp/core/errors";
import {
  isReservedCapabilityName,
  isValidCapabilityName,
  type Lease,
} from "@arcp/core/messages";

// ARCP v1.0 §9 — leases.
//
// A lease is an immutable record granted to a job at submission. It maps
// capability names to lists of glob patterns. Enforcement is the runtime's
// responsibility (§9.3). Validation is static; there is no lifecycle,
// extension, or revocation in v1.0.

/** Compile a single ARCP glob pattern into an anchored RegExp. */
export function compileGlob(pattern: string): RegExp {
  const re = patternToRegExp(pattern);
  return new RegExp(`^${re}$`);
}

/**
 * Convert an ARCP glob pattern to an anchored regex body.
 *
 * §9.2:
 *   - `*`   matches any single path or name segment (i.e. one segment, no `/`)
 *   - `**`  matches zero or more segments (multi-segment wildcard)
 *
 * All other regex metacharacters are escaped literally.
 */
function patternToRegExp(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        const isPrefixSlash = out.endsWith("/");
        const next = pattern[i + 2];
        const isSuffixSlash = next === "/";
        const atEnd = i + 2 >= pattern.length;
        // `/.../**/...` → strip trailing slash, replace with optional
        // `(?:/[^/]+)*/` so zero intermediate segments is also a match.
        if (isPrefixSlash && isSuffixSlash) {
          out = `${out.slice(0, -1)}(?:/[^/]+)*/`;
          i += 3;
          continue;
        }
        // `/.../**` at end of pattern → strip trailing slash and accept
        // zero or more segments INCLUDING the empty tail.
        if (isPrefixSlash && atEnd) {
          out = `${out.slice(0, -1)}(?:/[^/]+)*`;
          i += 2;
          continue;
        }
        // Bare `**` anywhere else.
        out += ".*";
        i += 2;
        continue;
      }
      // single-segment `*`
      out += "[^/]*";
      i += 1;
      continue;
    }
    // Escape regex metacharacters.
    if (/[\\^$.|?+()[\]{}]/.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

/**
 * Match `target` against `pattern` per §9.2 glob rules. Anchored at both
 * ends — no partial-string matches.
 */
export function matchGlob(pattern: string, target: string): boolean {
  return compileGlob(pattern).test(target);
}

/**
 * Canonicalize a target string before lease matching.
 *
 * §14 security requires this: the runtime MUST normalize paths and URLs
 * before pattern checking. Specifically:
 *
 *   - Resolve `.` and `..` segments.
 *   - Collapse repeated slashes.
 *   - Lower-case the scheme on URLs.
 */
export function canonicalizeTarget(target: string): string {
  // URL form: only lower-case scheme; leave the rest as-is.
  const urlMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target);
  if (urlMatch !== null) {
    const scheme = (urlMatch[1] ?? "").toLowerCase();
    return `${scheme}${target.slice(urlMatch[0].length - 1)}`;
  }
  // Path form: split, resolve `..` / `.`, drop empty segments except for the
  // leading slash that indicates absolute paths.
  const isAbsolute = target.startsWith("/");
  const parts = target.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  return (isAbsolute ? "/" : "") + out.join("/");
}

/**
 * Validate that `lease` permits an `operation` with `capability` on `target`.
 *
 * Throws {@link PermissionDeniedError} if no matching pattern exists.
 */
export function validateLeaseOp(
  lease: Lease,
  capability: string,
  target: string,
): void {
  const patterns = lease[capability];
  if (patterns === undefined || patterns.length === 0) {
    throw new PermissionDeniedError(
      `Capability "${capability}" is not granted by this lease`,
      {
        details: { capability, target },
      },
    );
  }
  const canonical = canonicalizeTarget(target);
  for (const pattern of patterns) {
    if (matchGlob(pattern, canonical)) return;
  }
  throw new PermissionDeniedError(
    `Lease denies "${capability}" on "${target}" (canonical "${canonical}")`,
    { details: { capability, target, canonical, patterns } },
  );
}

/**
 * Verify that `child` is a subset of `parent` (§9.4).
 *
 * Conservative semantics: returns true iff every pattern in every capability
 * of `child` is also matched by at least one pattern in the same capability
 * of `parent`. If a capability is absent from `parent` but present in `child`,
 * it's not a subset.
 *
 * Pattern-vs-pattern subset is approximated by "every string matching
 * `child_pattern` also matches `parent_pattern`". We use a syntactic check:
 * each `child_pattern` MUST match against some `parent_pattern` interpreted
 * as a regex, AND the parent pattern must be at least as general (we allow
 * exact equality and the cases where the parent is a strict super-pattern).
 *
 * A simple yet correct rule for the common cases: a child pattern `p2` is
 * subset-conforming under parent pattern `p1` iff `p1` matches every prefix
 * of `p2`'s segment specification. Implementations MAY validate more strictly;
 * we err on rejecting ambiguous cases.
 */
export function isLeaseSubset(child: Lease, parent: Lease): boolean {
  for (const cap of Object.keys(child)) {
    const childPatterns = child[cap] ?? [];
    const parentPatterns = parent[cap];
    if (parentPatterns === undefined || parentPatterns.length === 0)
      return false;
    for (const cp of childPatterns) {
      if (!patternSubsumes(parentPatterns, cp)) return false;
    }
  }
  return true;
}

/** Is `child` subsumed by any pattern in `parents`? */
function patternSubsumes(parents: readonly string[], child: string): boolean {
  for (const p of parents) {
    if (p === child) return true;
    // A pattern `p` subsumes `child` if `p` viewed as a regex matches the
    // string `child` directly — i.e. every concrete target matching `child`
    // is also covered by the broader `p`. This catches the common cases:
    //   parent="/a/**" subsumes child="/a/b" and child="/a/**".
    //   parent="*" subsumes child="x".
    if (compileGlob(p).test(child)) return true;
  }
  return false;
}

/**
 * Validate a lease at submit time:
 *   - every capability name must be reserved or `x-vendor.<vendor>.<name>`;
 *   - every pattern must be a non-empty string.
 *
 * Throws {@link InvalidRequestError} on malformed leases.
 */
export function validateLeaseShape(lease: Lease): void {
  for (const cap of Object.keys(lease)) {
    if (!isValidCapabilityName(cap)) {
      throw new InvalidRequestError(
        `Invalid capability name "${cap}"; must be one of the v1.0 reserved namespaces or "x-vendor.<vendor>.<cap>"`,
        { details: { capability: cap } },
      );
    }
    const patterns = lease[cap] ?? [];
    if (!Array.isArray(patterns)) {
      throw new InvalidRequestError(
        `Lease capability "${cap}" must map to an array of patterns`,
      );
    }
    for (const pattern of patterns) {
      if (typeof pattern !== "string" || pattern.length === 0) {
        throw new InvalidRequestError(
          `Lease capability "${cap}" contains an empty or non-string pattern`,
        );
      }
    }
  }
}

/**
 * Assert that `child` is a subset of `parent`, raising
 * {@link LeaseSubsetViolationError} otherwise.
 */
export function assertLeaseSubset(child: Lease, parent: Lease): void {
  if (!isLeaseSubset(child, parent)) {
    throw new LeaseSubsetViolationError(
      "Child lease is not a subset of parent lease",
      {
        details: { child, parent },
      },
    );
  }
}

export type { Lease };
// Re-export helpers that callers may want.
export { isReservedCapabilityName, isValidCapabilityName };
