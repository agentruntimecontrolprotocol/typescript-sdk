/**
 * ARCP v1.1 §9.7–§9.8 — Credential store interface.
 *
 * Tracks which credentials have been issued to which jobs so the runtime
 * can revoke them atomically when a job terminates, even across crashes.
 *
 * §14 (Credential revocation reliability): when a `CredentialProvisioner`
 * is configured, a `CredentialStore` MUST also be configured. The default
 * `InMemoryCredentialStore` is not crash-safe — use a durable implementation
 * for production deployments.
 *
 * The store does NOT hold credential values (`wire.value`). It holds only
 * the provisioner-side opaque identifier (`provisionerId`) that the
 * provisioner uses for revocation. This avoids persisting secrets.
 */

/** One row in the credential store. */
export interface CredentialStoreEntry {
  /** The job that owns this credential. */
  readonly jobId: string;
  /**
   * The `wire.id` from the issued credential. Unique within a job; used
   * for correlation in logs (but NOT the secret value).
   */
  readonly credentialId: string;
  /**
   * Opaque provisioner-side identifier for revocation (e.g., LiteLLM key name).
   * MUST NOT be the credential value itself.
   */
  readonly provisionerId: string;
  /** ISO 8601 UTC timestamp when the credential was issued. */
  readonly issuedAt: string;
}

/**
 * Minimal persistence interface for tracking outstanding credentials.
 *
 * The runtime calls `add()` immediately after `issue()` succeeds, before
 * `job.accepted` is sent. It calls `removeByJob()` in the terminal cleanup
 * path to get the list of entries to revoke.
 *
 * `listOutstanding()` is used by recovery tooling to revoke credentials for
 * jobs whose terminal cleanup was interrupted (e.g., process crash).
 */
export interface CredentialStore {
  /** Record a newly issued credential. */
  add(entry: CredentialStoreEntry): Promise<void>;
  /**
   * Remove all entries for `jobId` and return them so the caller can revoke
   * each via the provisioner. Returns an empty array if the job had no
   * outstanding entries.
   */
  removeByJob(jobId: string): Promise<CredentialStoreEntry[]>;
  /**
   * Return all entries that have not yet been removed (i.e., credentials
   * that may still be valid). Used by startup recovery sweeps.
   */
  listOutstanding(): Promise<CredentialStoreEntry[]>;
}

/**
 * Non-durable in-memory implementation. Suitable for tests, development, and
 * single-process deployments where losing the process also terminates all jobs.
 *
 * PRODUCTION WARNING: process crash loses all entries and therefore all
 * revocation records. Use a durable store (Redis, PostgreSQL, etc.) for
 * multi-process or long-lived deployments.
 */
export class InMemoryCredentialStore implements CredentialStore {
  /** Map from `jobId` to its outstanding credential entries. */
  private readonly _byJob = new Map<string, CredentialStoreEntry[]>();

  add(entry: CredentialStoreEntry): Promise<void> {
    let entries = this._byJob.get(entry.jobId);
    if (entries === undefined) {
      entries = [];
      this._byJob.set(entry.jobId, entries);
    }
    entries.push(entry);
    return Promise.resolve();
  }

  removeByJob(jobId: string): Promise<CredentialStoreEntry[]> {
    const entries = this._byJob.get(jobId) ?? [];
    this._byJob.delete(jobId);
    return Promise.resolve(entries);
  }

  listOutstanding(): Promise<CredentialStoreEntry[]> {
    const all: CredentialStoreEntry[] = [];
    for (const entries of this._byJob.values()) {
      all.push(...entries);
    }
    return Promise.resolve(all);
  }
}
