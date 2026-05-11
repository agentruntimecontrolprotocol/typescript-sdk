/** Warehouse DB admin agent. Reads pre-granted; writes prompt operator. */

import type { BaseEnvelope } from "../../src/index.js";
import {
  type ARCPClient,
  buildEnvelope,
  InvalidArgumentError,
  newMessageId,
  nowTimestamp,
  PermissionDeniedError,
} from "../../src/index.js";

import { classify } from "./sql.js";

const PRE_GRANTED = ["public.orders", "public.customers", "warehouse.fct_revenue_daily"];
const READ_LEASE_SECONDS = 60 * 60;
const WRITE_LEASE_SECONDS = 5 * 60;

type LeaseKey = string; // `${table}|${op}`
type LeaseEntry = { leaseId: string; expiresAt: Date };
type Leases = Map<LeaseKey, LeaseEntry>;

declare function request(
  client: ARCPClient,
  env: BaseEnvelope,
  timeoutMs: number,
): Promise<BaseEnvelope>;

async function requestLease(
  client: ARCPClient,
  args: { permission: string; table: string; operation: string; seconds: number; reason: string },
): Promise<LeaseEntry> {
  const reply = await request(
    client,
    buildEnvelope({
      id: newMessageId(),
      type: "permission.request",
      timestamp: nowTimestamp(),
      payload: {
        permission: args.permission,
        resource: `table:${args.table}`,
        operation: args.operation,
        reason: args.reason,
        requested_lease_seconds: args.seconds,
      },
    }) as BaseEnvelope,
    180_000,
  );
  if (reply.type === "permission.deny") {
    throw new PermissionDeniedError({ message: `${args.permission} denied on ${args.table}` });
  }
  const p = reply.payload as { lease_id: string; expires_at: string };
  return { leaseId: String(p.lease_id), expiresAt: new Date(p.expires_at) };
}

async function authorize(client: ARCPClient, sql: string, leases: Leases): Promise<string> {
  const klass = classify(sql);
  if (klass.tables.size === 0) {
    throw new InvalidArgumentError({ message: "no table referenced" });
  }
  const op = klass.op; // "read" / "write" / "ddl"
  const seconds = op === "read" ? READ_LEASE_SECONDS : WRITE_LEASE_SECONDS;
  for (const table of klass.tables) {
    const key: LeaseKey = `${table}|${op}`;
    const cached = leases.get(key);
    if (cached !== undefined && cached.expiresAt > new Date()) continue;
    leases.set(
      key,
      await requestLease(client, {
        permission: `db.${op}`,
        table,
        operation: op,
        seconds,
        reason: `${op.toUpperCase()} on ${table}: ${sql.slice(0, 80)}`,
      }),
    );
  }
  return op;
}

function handleInbound(env: BaseEnvelope, leases: Leases): void {
  // Wire `lease.revoked` into the cache so the next call re-prompts.
  if (env.type === "lease.revoked") {
    const lid = (env.payload as { lease_id?: string })?.lease_id;
    for (const [k, v] of leases) {
      if (v.leaseId === lid) leases.delete(k);
    }
  }
}

async function main(): Promise<void> {
  const client = null as unknown as ARCPClient; // transport, identity, auth elided

  const leases: Leases = new Map();
  client.on("lease.revoked", (env) => handleInbound(env, leases));

  // Pre-grant the broad reads at session open. From here on, SELECT
  // against these tables runs free.
  for (const table of PRE_GRANTED) {
    leases.set(
      `${table}|read`,
      await requestLease(client, {
        permission: "db.read",
        table,
        operation: "read",
        seconds: READ_LEASE_SECONDS,
        reason: "bootstrap",
      }),
    );
  }

  // SELECT — covered by the bootstrap lease.
  await authorize(
    client,
    "SELECT count(*) FROM public.orders WHERE shipped_at::date = current_date - 1",
    leases,
  );
  // UPDATE — triggers permission.request; operator must approve.
  await authorize(client, "UPDATE public.orders SET status='refunded' WHERE id=4812", leases);

  await client.close();
}

void main();
