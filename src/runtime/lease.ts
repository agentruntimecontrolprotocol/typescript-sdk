import { LeaseExpiredError, LeaseRevokedError, NotFoundError } from "../errors.js";
import type { LeaseGrantedPayload } from "../messages/index.js";
import { newLeaseId } from "../util/ulid.js";

/** State a lease can be in. */
export type LeaseState = "active" | "expired" | "revoked";

export interface LeaseRecord {
  readonly leaseId: string;
  readonly permission: string;
  readonly resource: string;
  readonly operation: string;
  expiresAtMs: number;
  state: LeaseState;
  revokedReason?: string;
}

/**
 * Lease lifecycle manager (§15.5).
 *
 * Tracks issued leases, lets the runtime check their validity at use-time,
 * supports refresh/extension and revocation. Uses real time (`Date.now()`)
 * for expiry comparison; tests can use fake timers to advance.
 */
export class LeaseManager {
  private readonly leases = new Map<string, LeaseRecord>();

  /** Issue a new lease and return the wire-shape payload for `lease.granted`. */
  public grant(opts: {
    permission: string;
    resource: string;
    operation: string;
    leaseSeconds: number;
  }): LeaseGrantedPayload {
    const leaseId = newLeaseId();
    const expiresAtMs = Date.now() + opts.leaseSeconds * 1000;
    const record: LeaseRecord = {
      leaseId,
      permission: opts.permission,
      resource: opts.resource,
      operation: opts.operation,
      expiresAtMs,
      state: "active",
    };
    this.leases.set(leaseId, record);
    return {
      lease_id: leaseId,
      permission: opts.permission,
      resource: opts.resource,
      operation: opts.operation,
      expires_at: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * Validate that `leaseId` is usable for `permission` on `resource` and
   * `operation`. Throws an appropriate error otherwise.
   */
  public use(args: {
    leaseId: string;
    permission: string;
    resource: string;
    operation: string;
  }): LeaseRecord {
    const record = this.leases.get(args.leaseId);
    if (record === undefined) {
      throw new NotFoundError(`Lease "${args.leaseId}" not found`);
    }
    if (record.state === "revoked") {
      throw new LeaseRevokedError(
        `Lease "${args.leaseId}" was revoked${record.revokedReason !== undefined ? `: ${record.revokedReason}` : ""}`,
      );
    }
    if (record.state === "expired" || record.expiresAtMs <= Date.now()) {
      record.state = "expired";
      throw new LeaseExpiredError(`Lease "${args.leaseId}" has expired`);
    }
    if (record.permission !== args.permission) {
      throw new LeaseRevokedError(
        `Lease "${args.leaseId}" permission mismatch: have "${record.permission}", asked for "${args.permission}"`,
      );
    }
    if (record.resource !== args.resource) {
      throw new LeaseRevokedError(
        `Lease "${args.leaseId}" resource mismatch: have "${record.resource}", asked for "${args.resource}"`,
      );
    }
    if (record.operation !== args.operation) {
      throw new LeaseRevokedError(
        `Lease "${args.leaseId}" operation mismatch: have "${record.operation}", asked for "${args.operation}"`,
      );
    }
    return record;
  }

  /** Extend a lease's expiry. Throws if the lease is missing or already terminal. */
  public extend(leaseId: string, seconds: number): { lease_id: string; expires_at: string } {
    const record = this.leases.get(leaseId);
    if (record === undefined) {
      throw new NotFoundError(`Lease "${leaseId}" not found`);
    }
    if (record.state !== "active") {
      throw new LeaseExpiredError(`Lease "${leaseId}" is not active (state=${record.state})`);
    }
    record.expiresAtMs = Date.now() + seconds * 1000;
    return {
      lease_id: leaseId,
      expires_at: new Date(record.expiresAtMs).toISOString(),
    };
  }

  /** Revoke a lease. Idempotent. */
  public revoke(leaseId: string, reason: string): boolean {
    const record = this.leases.get(leaseId);
    if (record === undefined) return false;
    record.state = "revoked";
    record.revokedReason = reason;
    return true;
  }

  /** Read-only access to a record (for tests/inspection). */
  public get(leaseId: string): LeaseRecord | undefined {
    return this.leases.get(leaseId);
  }

  /** Number of leases currently tracked (active or terminal). */
  public get size(): number {
    return this.leases.size;
  }

  /** Forget terminal leases. Run periodically by the runtime. */
  public sweep(): number {
    let removed = 0;
    const now = Date.now();
    for (const [id, record] of this.leases.entries()) {
      if (record.state === "revoked") {
        this.leases.delete(id);
        removed += 1;
      } else if (record.expiresAtMs <= now) {
        this.leases.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
