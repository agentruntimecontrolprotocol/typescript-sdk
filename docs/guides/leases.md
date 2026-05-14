# Leases (§9)

A lease is the capability grant for one job. It tells the runtime
what the agent is allowed to do — fetch which URLs, read which files,
call which tools. Leases are **immutable** at submit: the runtime can
narrow but never widen what the client requests.

## Shape

```ts
type Lease = {
  [capability: string]: readonly string[]; // glob patterns
};
```

A capability name is `<namespace>:<resource>`. Reserved namespaces:

| Namespace | What it gates |
| --- | --- |
| `fs.read` | Filesystem reads. Pattern is a path glob. |
| `fs.write` | Filesystem writes. |
| `net.fetch` | Outbound HTTP/S3/etc. Pattern is a URL glob. |
| `tool.call` | Tool invocation. Pattern matches against `tool` name. |
| `agent.delegate` | Spawning child jobs. Pattern matches child agent name. |

Custom namespaces MUST use `x-vendor.<vendor>.<cap>`:

```ts
const lease = {
  "x-vendor.acme.kafka.publish": ["topic-events-*"],
};
```

## Example

```ts
const handle = await client.submit({
  agent: "weekly-report",
  input: { week: "2026-W19" },
  lease: {
    "net.fetch":      ["https://api.example.com/**", "s3://reports-bucket/**"],
    "tool.call":      ["web.*", "summarize"],
    "agent.delegate": ["pdf-renderer@*"],
  },
});
```

## Glob matching (§9.2)

- `*` matches a single path segment (no slash).
- `**` matches zero or more segments (crosses slashes).
- Matching is **anchored**: the pattern must match the full target,
  not just a prefix.

Examples:

| Pattern | Matches | Does not match |
| --- | --- | --- |
| `https://api.example.com/*` | `https://api.example.com/v1` | `https://api.example.com/v1/users` |
| `https://api.example.com/**` | `https://api.example.com/v1/users/42` | `https://other.example.com/` |
| `s3://reports/**.csv` | `s3://reports/2026/W19.csv` | `s3://reports/2026/W19.json` |
| `tool.call:web.*` | `web.search` | `web.search.advanced` (extra segment) |

## Canonicalization (§14)

Before pattern matching, the runtime canonicalizes the target to
prevent obvious bypasses:

- `..` and `.` path segments collapse.
- URL scheme is lower-cased; default ports are dropped.
- Repeated slashes collapse to one.
- Trailing slashes are normalized.
- Percent-encoded ASCII control chars are decoded.

This means `https://API.example.com:443/path/../other` is checked as
`https://api.example.com/other`. Patterns should be written against
the canonical form.

## Immutability at submit

The runtime may **reduce** the lease (drop a capability, narrow a
pattern) but never widen it. The reduction shows up on `job.accepted`:

```ts
const handle = await client.submit({
  agent: "x",
  input: {},
  lease: {
    "net.fetch": ["https://**"],
    "fs.write":  ["/tmp/**"],
  },
});

console.log(handle.lease);
// runtime might have reduced to:
// { "net.fetch": ["https://api.example.com/**"], "fs.write": [] }
```

There is no extension, refresh, or revocation verb in ARCP. If an
agent needs more capability mid-job, submit a fresh job with the
broader lease — that's the bright line.

## Enforcement points

The runtime checks the lease at the moment of operation:

| Event | Check |
| --- | --- |
| `tool_call` | `tool.call:<tool>` matches; specific tools may check sub-namespaces. |
| `delegate` | child `lease_request` is a subset of parent's effective lease. |
| `tool_result` carrying URL fetches | implicit `net.fetch` check inside the tool implementation. |

When a check fails, the runtime emits a `tool_result` on the parent
with `error.code: "PERMISSION_DENIED"` (or, for delegation,
`LEASE_SUBSET_VIOLATION`). The agent decides whether to recover or
fail.

## Subset validation

A lease `A` is a subset of lease `B` if every capability/pattern in
`A` is covered by `B`:

```ts
import { isLeaseSubset } from "@arcp/sdk";

const parent = {
  "net.fetch": ["https://api.example.com/**"],
  "tool.call": ["web.*"],
};
const child = {
  "net.fetch": ["https://api.example.com/v1/**"],
  "tool.call": ["web.search"],
};

isLeaseSubset(child, parent); // true
isLeaseSubset(parent, child); // false (parent has web.* not in child)
```

`assertLeaseSubset(child, parent)` throws
`LeaseSubsetViolationError` on mismatch — useful from custom auth
policies.

## Expiration (v1.1, §9.5)

`leaseConstraints` can carry an `expires_at` ISO timestamp:

```ts
await client.submit({
  agent: "fetcher",
  input: {},
  lease: { "net.fetch": ["https://**"] },
  leaseConstraints: {
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  },
});
```

Once expired, `tool_call` and other lease-gated operations return
`LeaseExpiredError`. The job continues running — agent decides
whether to abort.

## Budgets (v1.1, §9.6)

`leaseConstraints.budgets` is `{ currency: amount }`:

```ts
await client.submit({
  agent: "research",
  input: {},
  lease: { "net.fetch": ["https://**"] },
  leaseConstraints: {
    budgets: { usd: 2.00, tokens: 100_000 },
  },
});
```

Agents drive consumption via `ctx.metric()` — when `unit` matches a
budget currency, the runtime decrements. Exhaustion throws
`BudgetExhaustedError` from the next lease-gated operation.

The runtime also emits a `metric` event with name `budget_remaining`
when consumption crosses 5% deltas (debounced).

## Hand-written validation

`validateLeaseShape(lease)` checks structural well-formedness;
`isReservedCapabilityName(name)` distinguishes reserved namespaces
from vendor ones. Useful when accepting leases from upstream services:

```ts
import { validateLeaseShape, isReservedCapabilityName } from "@arcp/sdk";

const incoming = JSON.parse(req.body.lease);
validateLeaseShape(incoming); // throws on malformed
for (const cap of Object.keys(incoming)) {
  if (!isReservedCapabilityName(cap) && !cap.startsWith("x-vendor.")) {
    throw new Error(`bad capability namespace: ${cap}`);
  }
}
```

## Runnable examples

- [`examples/lease-violation/`](../../examples/lease-violation/) — denied access surfaces as `tool_result.error`.
- [`examples/lease-expires-at/`](../../examples/lease-expires-at/) — v1.1 expiration.
- [`examples/cost-budget/`](../../examples/cost-budget/) — v1.1 budgets.
- [`examples/delegate/`](../../examples/delegate/) — subset validation on child spawn.
