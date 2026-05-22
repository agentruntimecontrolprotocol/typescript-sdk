// Effect-shaped wrappers over the pure {@link ./lease.ts} validation helpers.
//
// The legacy `validateLeaseOp`, `assertLeaseSubset`, and
// `validateLeaseConstraints` throw on failure (typed via the `ARCPError`
// hierarchy). This file exposes thin `Effect`-valued twins that translate
// those throws into typed {@link TaggedSdkError} channel failures. No new
// behavior — pure surface adaptation so call sites inside `Effect.gen` can
// compose lease checks without `Effect.try` boilerplate.

import {
  taggedFromARCP,
  type TaggedBudgetExhausted,
  type TaggedInvalidRequest,
  type TaggedLeaseExpired,
  type TaggedLeaseSubsetViolation,
  type TaggedPermissionDenied,
  type TaggedSdkError,
} from "@agentruntimecontrolprotocol/core";
import { ARCPError as ARCPErrorClass } from "@agentruntimecontrolprotocol/core/errors";
import type { Lease, LeaseConstraints } from "@agentruntimecontrolprotocol/core/messages";
import { Effect } from "effect";

import {
  assertLeaseConstraintsSubset,
  assertLeaseSubset,
  validateLeaseConstraints,
  validateLeaseOp,
  type ValidateLeaseOpInput,
} from "./lease.js";

/**
 * §9.3 lease validation failures. Mirrors the legacy throw set of
 * {@link validateLeaseOp}: capability mismatch, lease expiration, and
 * budget exhaustion.
 */
export type ValidateLeaseOpFailure =
  | TaggedBudgetExhausted
  | TaggedLeaseExpired
  | TaggedPermissionDenied;

/**
 * Effect twin of {@link validateLeaseOp}. Succeeds with `void`; on a legacy
 * throw, lifts the {@link ARCPError} subclass through {@link taggedFromARCP}
 * onto the typed-error channel.
 *
 * The error channel is narrowed to {@link ValidateLeaseOpFailure} — any
 * other `ARCPError` subclass leaking from `validateLeaseOp` is an
 * implementation bug and surfaces as an Effect defect.
 *
 * @example
 * ```ts
 * yield* validateLeaseOpEffect({ lease, capability: "fs.read", target: "/a" })
 * ```
 */
export function validateLeaseOpEffect(
  input: ValidateLeaseOpInput,
): Effect.Effect<void, ValidateLeaseOpFailure> {
  return Effect.try({
    try: () => {
      validateLeaseOp(input);
    },
    catch: narrowValidateLeaseOpFailure,
  });
}

/**
 * Effect twin of {@link assertLeaseSubset}. Succeeds with `void`; on a legacy
 * throw, surfaces a {@link TaggedLeaseSubsetViolation} on the typed channel.
 */
export function assertLeaseSubsetEffect(
  child: Lease,
  parent: Lease,
  parentBudgetRemaining?: ReadonlyMap<string, number>,
): Effect.Effect<void, TaggedLeaseSubsetViolation> {
  return Effect.try({
    try: () => {
      assertLeaseSubset(child, parent, parentBudgetRemaining);
    },
    catch: narrowSubsetViolation,
  });
}

/**
 * Effect twin of {@link assertLeaseConstraintsSubset}.
 */
export function assertLeaseConstraintsSubsetEffect(
  child: LeaseConstraints | undefined,
  parent: LeaseConstraints | undefined,
): Effect.Effect<void, TaggedLeaseSubsetViolation> {
  return Effect.try({
    try: () => {
      assertLeaseConstraintsSubset(child, parent);
    },
    catch: narrowSubsetViolation,
  });
}

/**
 * Effect twin of {@link validateLeaseConstraints}. Returns the parsed
 * millisecond expiry (or `null` when no `expires_at` was supplied);
 * malformed/past values surface as {@link TaggedInvalidRequest}.
 */
export function validateLeaseConstraintsEffect(
  constraints: LeaseConstraints | undefined,
  now?: number,
): Effect.Effect<number | null, TaggedInvalidRequest> {
  return Effect.try({
    try: () => validateLeaseConstraints(constraints, now),
    catch: narrowInvalidRequest,
  });
}

/**
 * Narrow `cause` to a known `ARCPError` and translate it through
 * {@link taggedFromARCP}; non-`ARCPError` defects are re-thrown so they
 * surface as Effect defects (preserving the legacy "unexpected throw"
 * channel rather than masquerading as a typed failure).
 */
function liftAsTagged(cause: unknown): TaggedSdkError {
  if (cause instanceof ARCPErrorClass) return taggedFromARCP(cause);
  throw cause as Error;
}

function narrowValidateLeaseOpFailure(cause: unknown): ValidateLeaseOpFailure {
  const lifted = liftAsTagged(cause);
  if (
    lifted.code === "BUDGET_EXHAUSTED" ||
    lifted.code === "LEASE_EXPIRED" ||
    lifted.code === "PERMISSION_DENIED"
  ) {
    return lifted;
  }
  throw new Error(`Unexpected lease op failure code: ${lifted.code}`);
}

function narrowSubsetViolation(cause: unknown): TaggedLeaseSubsetViolation {
  const lifted = liftAsTagged(cause);
  if (lifted.code === "LEASE_SUBSET_VIOLATION") return lifted;
  throw new Error(`Unexpected lease subset failure code: ${lifted.code}`);
}

function narrowInvalidRequest(cause: unknown): TaggedInvalidRequest {
  const lifted = liftAsTagged(cause);
  if (lifted.code === "INVALID_REQUEST") return lifted;
  throw new Error(
    `Unexpected validate-constraints failure code: ${lifted.code}`,
  );
}
