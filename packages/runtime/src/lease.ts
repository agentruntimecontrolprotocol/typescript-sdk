import {
  BudgetExhaustedError,
  InvalidRequestError,
  LeaseExpiredError,
  LeaseSubsetViolationError,
  PermissionDeniedError,
} from "@agentruntimecontrolprotocol/core/errors";
import {
  isValidCapabilityName,
  type Lease,
  type LeaseConstraints,
  parseBudgetAmount,
} from "@agentruntimecontrolprotocol/core/messages";

import type { LeaseOpContext } from "./types.js";

// ARCP v1.1 §9 — leases.
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
    const ch = pattern[i];
    if (ch === undefined) break;
    const step = consumePatternToken(pattern, i, out);
    out = step.out;
    i = step.next;
  }
  return out;
}

interface PatternStep {
  out: string;
  next: number;
}

function consumePatternToken(
  pattern: string,
  i: number,
  out: string,
): PatternStep {
  const ch = pattern[i];
  if (ch === "*") return consumeStar(pattern, i, out);
  const escaped = /[\\^$.|?+()[\]{}]/.test(ch ?? "")
    ? `\\${ch ?? ""}`
    : (ch ?? "");
  return { out: out + escaped, next: i + 1 };
}

function consumeStar(pattern: string, i: number, out: string): PatternStep {
  if (pattern[i + 1] !== "*") {
    // single-segment `*`
    return { out: `${out}[^/]*`, next: i + 1 };
  }
  return consumeDoubleStar(pattern, i, out);
}

function consumeDoubleStar(
  pattern: string,
  i: number,
  out: string,
): PatternStep {
  const isPrefixSlash = out.endsWith("/");
  const isSuffixSlash = pattern[i + 2] === "/";
  const atEnd = i + 2 >= pattern.length;
  // `/.../**/...` → strip trailing slash, replace with optional
  // `(?:/[^/]+)*/` so zero intermediate segments is also a match.
  if (isPrefixSlash && isSuffixSlash) {
    return { out: `${out.slice(0, -1)}(?:/[^/]+)*/`, next: i + 3 };
  }
  // `/.../**` at end of pattern → strip trailing slash and accept
  // zero or more segments INCLUDING the empty tail.
  if (isPrefixSlash && atEnd) {
    return { out: `${out.slice(0, -1)}(?:/[^/]+)*`, next: i + 2 };
  }
  // Bare `**` anywhere else.
  return { out: `${out}.*`, next: i + 2 };
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
 *
 * When v1.1 `ctx.constraints.expires_at` is set and elapsed, throws
 * {@link LeaseExpiredError}. When v1.1 `ctx.budgetRemaining` is set and any
 * currency counter has dropped to zero or below, throws
 * {@link BudgetExhaustedError}. Both checks fire BEFORE the pattern match
 * — they bound the lease as a whole, not any single capability.
 */
export interface ValidateLeaseOpInput {
  readonly lease: Lease;
  readonly capability: string;
  readonly target: string;
  readonly ctx?: LeaseOpContext;
}

export function validateLeaseOp(input: ValidateLeaseOpInput): void {
  const { lease, capability, target, ctx = {} } = input;
  checkLeaseExpiration(capability, target, ctx);
  checkBudgetExhaustion(capability, target, ctx);
  checkCapabilityMatch(lease, capability, target);
}

function checkLeaseExpiration(
  capability: string,
  target: string,
  ctx: LeaseOpContext,
): void {
  // v1.1 §9.5: lease expiration check (applies to every operation).
  const expiresAt = ctx.constraints?.expires_at;
  if (expiresAt === undefined) return;
  const now = ctx.now ?? Date.now();
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs) || now < expiresMs) return;
  throw new LeaseExpiredError(`Lease expired at ${expiresAt}`, {
    details: { capability, target, expires_at: expiresAt },
  });
}

function checkBudgetExhaustion(
  capability: string,
  target: string,
  ctx: LeaseOpContext,
): void {
  // v1.1 §9.6: budget exhaustion (across all currencies).
  if (ctx.budgetRemaining === undefined || capability === "cost.budget") return;
  for (const [currency, remaining] of ctx.budgetRemaining.entries()) {
    if (remaining <= 0) {
      throw new BudgetExhaustedError(`${currency} budget exhausted`, {
        details: { capability, target, currency, remaining },
      });
    }
  }
}

function checkCapabilityMatch(
  lease: Lease,
  capability: string,
  target: string,
): void {
  const patterns = lease[capability];
  if (patterns === undefined || patterns.length === 0) {
    throw new PermissionDeniedError(
      `Capability "${capability}" is not granted by this lease`,
      { details: { capability, target } },
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
 * Compute the initial per-currency budget counters from a lease's
 * `cost.budget` patterns. Each pattern MUST parse as `currency:decimal`
 * (v1.1 §9.6); when multiple entries share a currency, the values sum.
 */
export function initialBudgetFromLease(lease: Lease): Map<string, number> {
  const out = new Map<string, number>();
  const patterns = lease["cost.budget"];
  if (patterns === undefined) return out;
  for (const p of patterns) {
    const { currency, amount } = parseBudgetAmount(p);
    out.set(currency, (out.get(currency) ?? 0) + amount);
  }
  return out;
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
 *
 * v1.1 §9.4: `cost.budget` is compared as numeric per-currency totals (not
 * patterns); a child's total per currency MUST NOT exceed the parent's. If
 * `parentBudgetRemaining` is supplied, that "remaining" total is used
 * instead of the parent's original budget — for delegation that occurs
 * mid-execution.
 */
export function isLeaseSubset(
  child: Lease,
  parent: Lease,
  parentBudgetRemaining?: ReadonlyMap<string, number>,
): boolean {
  for (const cap of Object.keys(child)) {
    const childPatterns = child[cap] ?? [];
    if (cap === "cost.budget") {
      if (!isBudgetSubset(childPatterns, parent, parentBudgetRemaining)) {
        return false;
      }
      continue;
    }
    if (!isCapabilitySubset(parent[cap], childPatterns)) return false;
  }
  return true;
}

function isCapabilitySubset(
  parentPatterns: readonly string[] | undefined,
  childPatterns: readonly string[],
): boolean {
  if (parentPatterns === undefined || parentPatterns.length === 0) return false;
  for (const cp of childPatterns) {
    if (!patternSubsumes(parentPatterns, cp)) return false;
  }
  return true;
}

function isBudgetSubset(
  childPatterns: readonly string[],
  parent: Lease,
  parentBudgetRemaining: ReadonlyMap<string, number> | undefined,
): boolean {
  const childTotals = sumBudgetPatterns(childPatterns);
  if (childTotals === null) return false;
  const parentTotals =
    parentBudgetRemaining ?? sumBudgetPatterns(parent["cost.budget"] ?? []);
  if (parentTotals === null) return false;
  for (const [currency, total] of childTotals.entries()) {
    const allowed = parentTotals.get(currency);
    if (allowed === undefined || total > allowed) return false;
  }
  return true;
}

function sumBudgetPatterns(
  patterns: readonly string[],
): Map<string, number> | null {
  const m = new Map<string, number>();
  for (const p of patterns) {
    try {
      const { currency, amount } = parseBudgetAmount(p);
      m.set(currency, (m.get(currency) ?? 0) + amount);
    } catch {
      return null;
    }
  }
  return m;
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
        `Invalid capability name "${cap}"; must be one of the reserved namespaces or "x-vendor.<vendor>.<cap>"`,
        { details: { capability: cap } },
      );
    }
    validateLeaseCapPatterns(cap, lease[cap] ?? []);
  }
}

function validateLeaseCapPatterns(cap: string, patterns: unknown): void {
  if (!Array.isArray(patterns)) {
    throw new InvalidRequestError(
      `Lease capability "${cap}" must map to an array of patterns`,
    );
  }
  for (const pattern of patterns) {
    validateLeasePattern(cap, pattern);
  }
}

function validateLeasePattern(cap: string, pattern: unknown): void {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new InvalidRequestError(
      `Lease capability "${cap}" contains an empty or non-string pattern`,
    );
  }
  // v1.1 §9.6: cost.budget patterns are amount strings, not globs.
  if (cap !== "cost.budget") return;
  try {
    parseBudgetAmount(pattern);
  } catch (error) {
    throw new InvalidRequestError(
      error instanceof Error ? error.message : String(error),
      { details: { capability: cap, pattern } },
    );
  }
}

/**
 * Assert that `child` is a subset of `parent`, raising
 * {@link LeaseSubsetViolationError} otherwise.
 *
 * v1.1: `parentBudgetRemaining` enforces §9.4 — at delegation time, the
 * child's `cost.budget` MUST NOT exceed the parent's REMAINING budget.
 */
export function assertLeaseSubset(
  child: Lease,
  parent: Lease,
  parentBudgetRemaining?: ReadonlyMap<string, number>,
): void {
  if (!isLeaseSubset(child, parent, parentBudgetRemaining)) {
    throw new LeaseSubsetViolationError(
      "Child lease is not a subset of parent lease",
      {
        details: { child, parent },
      },
    );
  }
}

/**
 * v1.1 §9.4 / §9.5: assert child's `lease_constraints.expires_at` is at or
 * before the parent's. A child with no `expires_at` inherits the parent's
 * implicitly (the caller is responsible for that inheritance); this check
 * only validates the explicit case.
 */
export function assertLeaseConstraintsSubset(
  childConstraints: LeaseConstraints | undefined,
  parentConstraints: LeaseConstraints | undefined,
): void {
  const childExpiry = childConstraints?.expires_at;
  const parentExpiry = parentConstraints?.expires_at;
  if (childExpiry === undefined) return;
  if (parentExpiry === undefined) return;
  const c = Date.parse(childExpiry);
  const p = Date.parse(parentExpiry);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return;
  if (c > p) {
    throw new LeaseSubsetViolationError(
      "Child lease_constraints.expires_at exceeds parent's expires_at",
      {
        details: {
          child_expires_at: childExpiry,
          parent_expires_at: parentExpiry,
        },
      },
    );
  }
}

/**
 * v1.1 §9.5: validate a submitted `lease_constraints.expires_at` value.
 * MUST be ISO 8601 UTC (`Z` suffix) and MUST be in the future.
 *
 * Returns the parsed millisecond timestamp; throws {@link InvalidRequestError}
 * on malformed/past values.
 */
export function validateLeaseConstraints(
  constraints: LeaseConstraints | undefined,
  now: number = Date.now(),
): number | null {
  if (constraints === undefined) return null;
  const expiresAt = constraints.expires_at;
  if (expiresAt === undefined) return null;
  if (!expiresAt.endsWith("Z")) {
    throw new InvalidRequestError(
      `lease_constraints.expires_at MUST be UTC (suffix "Z")`,
      { details: { expires_at: expiresAt } },
    );
  }
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) {
    throw new InvalidRequestError(
      `lease_constraints.expires_at is not a valid ISO 8601 timestamp`,
      { details: { expires_at: expiresAt } },
    );
  }
  if (ms <= now) {
    throw new InvalidRequestError(
      `lease_constraints.expires_at MUST be in the future`,
      { details: { expires_at: expiresAt, now } },
    );
  }
  return ms;
}

// Re-export helpers that callers may want.

export {
  isReservedCapabilityName,
  type Lease,
  isValidCapabilityName,
} from "@agentruntimecontrolprotocol/core/messages";
