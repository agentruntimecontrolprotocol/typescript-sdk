import { describe, expect, it } from "vitest";
import {
  LeaseExpiredError,
  LeaseManager,
  LeaseRevokedError,
  NotFoundError,
} from "../../src/index.js";

describe("LeaseManager", () => {
  it("starts empty", () => {
    expect(new LeaseManager().size).toBe(0);
  });

  it("revoke of unknown lease returns false", () => {
    expect(new LeaseManager().revoke("nope", "test")).toBe(false);
  });

  it("get returns the record", () => {
    const m = new LeaseManager();
    const g = m.grant({ permission: "p", resource: "r", operation: "o", leaseSeconds: 60 });
    const rec = m.get(g.lease_id);
    expect(rec?.permission).toBe("p");
  });

  it("use of unknown lease throws NotFoundError", () => {
    const m = new LeaseManager();
    expect(() =>
      m.use({ leaseId: "nope", permission: "p", resource: "r", operation: "o" }),
    ).toThrow(NotFoundError);
  });

  it("extend of unknown lease throws NotFoundError", () => {
    const m = new LeaseManager();
    expect(() => m.extend("nope", 30)).toThrow(NotFoundError);
  });

  it("extend of revoked lease throws LeaseExpiredError", () => {
    const m = new LeaseManager();
    const g = m.grant({ permission: "p", resource: "r", operation: "o", leaseSeconds: 60 });
    m.revoke(g.lease_id, "test");
    expect(() => m.extend(g.lease_id, 30)).toThrow(LeaseExpiredError);
  });

  it("sweep removes expired and revoked leases", async () => {
    const m = new LeaseManager();
    const expired = m.grant({
      permission: "p",
      resource: "r",
      operation: "o",
      leaseSeconds: 0.005,
    });
    const active = m.grant({ permission: "p", resource: "r", operation: "o", leaseSeconds: 60 });
    const revoked = m.grant({ permission: "p", resource: "r", operation: "o", leaseSeconds: 60 });
    m.revoke(revoked.lease_id, "x");
    await new Promise<void>((r) => setTimeout(r, 20));
    const removed = m.sweep();
    expect(removed).toBe(2);
    expect(m.size).toBe(1);
    expect(m.get(active.lease_id)).toBeDefined();
    void LeaseRevokedError;
    void expired;
  });
});
