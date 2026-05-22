import { Schema } from "effect";

/**
 * ARCP v1.1 §9.7–§9.8 — Provisioned credentials wire shapes.
 *
 * The runtime may mint short-lived, scope-restricted credentials at job
 * acceptance time and embed them in `job.accepted.payload.credentials`.
 * Credentials are revoked when the job reaches a terminal state.
 *
 * §9.8.1 — `CredentialConstraints` describes the scope the runtime
 * applied when issuing the credential (subset of the `model.use` lease
 * patterns). Clients MUST NOT cache or re-use credentials beyond
 * `expires_at`.
 *
 * SECURITY: The `value` field carries a secret (API key, bearer token,
 * etc.). Implementors MUST:
 *   - Never log, trace, or export `value`.
 *   - Never echo `value` to a subscriber that is not the job submitter.
 *   - Only emit credentials over authenticated, encrypted transports.
 */

// §9.8.1 — constraints embedded in the issued credential.
export const CredentialConstraintsSchema = Schema.Struct({
  /** ISO 8601 UTC expiry (`Z`-suffix required). */
  expires_at: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  /**
   * Glob patterns for the models this credential may invoke.
   * Maps to the `model.use` lease globs (possibly narrowed by the provisioner).
   */
  allowed_models: Schema.optional(
    Schema.mutable(Schema.Array(Schema.String.pipe(Schema.nonEmptyString()))),
  ),
  /**
   * Spend cap enforced by the upstream service (advisory — the provisioner
   * or the upstream service enforces it; the ARCP runtime tracks `cost.budget`
   * separately).
   */
  max_spend: Schema.optional(
    Schema.Struct({
      currency: Schema.String.pipe(Schema.nonEmptyString()),
      amount: Schema.Number.pipe(Schema.nonNegative()),
    }),
  ),
});
export type CredentialConstraints = Schema.Schema.Type<
  typeof CredentialConstraintsSchema
>;

// §9.8 — a single provisioned credential.
export const CredentialSchema = Schema.Struct({
  /** Opaque identifier; unique within the job. Used to correlate revocations. */
  id: Schema.String.pipe(Schema.nonEmptyString()),
  /** Authentication scheme the endpoint accepts. Only `"bearer"` is reserved. */
  scheme: Schema.Literal("bearer"),
  /**
   * The secret credential value (API key, bearer token, etc.).
   *
   * SECURITY: MUST NOT appear in logs, traces, or telemetry. MUST be redacted
   * before forwarding to any party other than the job submitter.
   */
  value: Schema.String.pipe(Schema.nonEmptyString()),
  /** Base URL of the service this credential authorises against. */
  endpoint: Schema.String.pipe(Schema.nonEmptyString()),
  /**
   * Optional service-specific profile identifier (e.g., LiteLLM key alias,
   * model deployment name). Interpretation is backend-defined.
   */
  profile: Schema.optional(Schema.String.pipe(Schema.nonEmptyString())),
  /** Constraints applied when the credential was issued. */
  constraints: Schema.optional(CredentialConstraintsSchema),
});
export type Credential = Schema.Schema.Type<typeof CredentialSchema>;
