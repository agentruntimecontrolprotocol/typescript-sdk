# leases

Sandboxed on-call agent. Every shell mutation is gated by a one-shot
lease scoped to the specific binary + target. Read-only commands run
under a long-lived `host.read` lease.

## Before ARCP

Two ad-hoc paths in the wild: (1) the agent has shell and just runs
things — operator finds out from `last`. (2) every command goes
through a Slack approval bot that the agent learns to game by
splitting destructive calls into innocuous-looking pairs. Neither
gives the operator a typed contract over what was approved.

## With ARCP

```ts
const grant = await client.requestPermission({
  permission: "host.write",
  resource: `host:${host}/usr/bin/systemctl/api-gateway`,
  operation: "restart",
  reason: "service is OOMing every 4 minutes",
  requested_lease_seconds: 60,
});
// returns { lease_id, expires_at, ... } or throws PermissionDeniedError.
```

The lease is scoped to `(binary, target)` so the agent can't reuse
a `restart api-gateway` grant to `restart database`.

## ARCP primitives

- Permission challenge — RFC §15.4.
- Lease lifecycle (request → grant → use → revoke) — §15.5.
- `kind: thought` reasoning stream — §11.4.
- `PERMISSION_DENIED`, `LEASE_EXPIRED`, `LEASE_REVOKED` — §18.2.
- Trust level `constrained` advertised in identity — §15.3.

## File tour

- `main.ts` — opens session, wires the agent, runs one ticket.
- `agent.ts` — emits `kind: thought`, calls into the sandbox. The
  LLM call is stubbed (`llmLoop`) so the file is about ARCP, not
  Anthropic.

## Variations

- `trust.elevate.privileged` flow for the once-a-quarter
  `iptables -F` (§15.6) — same primitive, different permission.
- Replace operator approval with a policy engine (OPA, Cedar) — the
  responder is interchangeable as long as it emits `lease.granted`.
- Mirror the `kind: thought` stream into
  [subscriptions](../subscriptions) for postmortem replay.
