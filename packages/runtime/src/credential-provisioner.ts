import type { JobId, TraceId } from "@agentruntimecontrolprotocol/core";
import { BudgetExhaustedError } from "@agentruntimecontrolprotocol/core/errors";
import type { Credential, Lease, LeaseConstraints } from "@agentruntimecontrolprotocol/core/messages";

/**
 * ARCP v1.1 §9.7–§9.8 — Credential provisioner interface.
 *
 * The runtime calls `issue()` immediately after a job is accepted (before
 * `job.accepted` is sent). It calls `revoke()` for each issued credential
 * when the job reaches a terminal state.
 *
 * Implementations MUST NOT log the `wire.value` field — it is a secret.
 * Implementations SHOULD be idempotent: a duplicate `issue()` with the
 * same `jobId` should return the same or equivalent credentials.
 *
 * Reference backend: LiteLLM `/key/generate` + `/key/delete`.
 */

/**
 * Issued credential pairing: the wire shape sent to the client and the
 * opaque provisioner-side identifier used for revocation.
 */
export interface IssuedCredential {
  /**
   * The wire-form credential. Its `value` field is a secret and MUST NOT
   * appear in logs, traces, or telemetry. MUST be omitted when forwarding
   * to any party that is not the original job submitter.
   */
  readonly wire: Credential;
  /**
   * Opaque handle the provisioner uses to revoke this credential (e.g., the
   * key ID returned by LiteLLM `/key/generate`). Not transmitted to clients.
   */
  readonly provisionerId: string;
}

/**
 * Context passed to `CredentialProvisioner.issue()`. Contains all information
 * the provisioner needs to decide what credentials (if any) to mint.
 */
export interface CredentialIssueContext {
  /** The job that will receive the credentials. */
  readonly jobId: JobId;
  /** Set when this is a delegated child job. */
  readonly parentJobId?: JobId | undefined;
  /** The effective lease (possibly narrower than the request). */
  readonly lease: Lease;
  /** v1.1 §9.5 — lease constraints, if any. */
  readonly leaseConstraints: LeaseConstraints | undefined;
  /** Initial per-currency budget. Empty map when `cost.budget` is absent. */
  readonly initialBudget: ReadonlyMap<string, number>;
  /** The authenticated principal that submitted the job. */
  readonly principal: string | undefined;
  /** W3C trace id for OTel correlation. */
  readonly traceId: TraceId | undefined;
}

/**
 * Vendor-neutral credential provisioner (§9.7).
 *
 * Implement this interface and pass it to `ARCPServerOptions.credentialProvisioner`
 * to enable provisioned credentials. The runtime advertises the
 * `provisioned_credentials` and `model.use` feature flags only when a
 * provisioner is configured.
 *
 * @example
 * ```ts
 * import type { CredentialProvisioner, IssuedCredential, CredentialIssueContext } from "@agentruntimecontrolprotocol/runtime";
 *
 * class LiteLLMProvisioner implements CredentialProvisioner {
 *   async issue(ctx: CredentialIssueContext): Promise<IssuedCredential[]> {
 *     const models = ctx.lease["model.use"] ?? [];
 *     if (models.length === 0) return [];
 *
 *     const res = await fetch("https://litellm.example.com/key/generate", {
 *       method: "POST",
 *       headers: { Authorization: `Bearer ${this.adminKey}` },
 *       body: JSON.stringify({ models, duration: "3600s" }),
 *     });
 *     const { key, key_name } = await res.json();
 *     return [{
 *       wire: {
 *         id: ctx.jobId + "-llm",
 *         scheme: "bearer",
 *         value: key,        // ← SECRET — never log
 *         endpoint: "https://litellm.example.com/v1",
 *         constraints: { allowed_models: models },
 *       },
 *       provisionerId: key_name,
 *     }];
 *   }
 *
 *   async revoke(provisionerId: string): Promise<void> {
 *     await fetch("https://litellm.example.com/key/delete", {
 *       method: "POST",
 *       headers: { Authorization: `Bearer ${this.adminKey}` },
 *       body: JSON.stringify({ keys: [provisionerId] }),
 *     });
 *   }
 * }
 * ```
 */
export interface CredentialProvisioner {
  /**
   * Mint credentials for a newly accepted job.
   *
   * Called synchronously in the accept path, before `job.accepted` is sent.
   * Return an empty array if the job's lease contains no `model.use` entries
   * or if no credentials are needed.
   *
   * MUST NOT throw unless credential issuance is entirely unrecoverable — in
   * that case the runtime will reject the job with `INTERNAL_ERROR`.
   */
  issue(ctx: CredentialIssueContext): Promise<IssuedCredential[]>;

  /**
   * Revoke a previously issued credential.
   *
   * Called once per `IssuedCredential` when the job reaches any terminal
   * state (`success`, `error`, `cancelled`, `timed_out`). Must be
   * idempotent — the runtime may call it more than once for a given
   * `provisionerId` under retry or at-least-once semantics.
   *
   * Failures should be logged by the provisioner but MUST NOT propagate —
   * the runtime swallows errors here to avoid blocking job cleanup.
   */
  revoke(provisionerId: string): Promise<void>;
}

/**
 * Translate an upstream spend-cap failure into the ARCP boundary error.
 *
 * Provisioner implementations should call this when the cost-bearing service
 * reports that a minted key exhausted its budget. The original error is kept
 * as the cause, but secret-bearing vendor payloads should be stripped before
 * passing `details`.
 */
export function toBudgetExhausted(
  error: unknown,
  details: Record<string, unknown> = {},
): never {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "Upstream budget exhausted";
  throw new BudgetExhaustedError(message, {
    details,
    cause: error instanceof Error ? error : undefined,
  });
}
