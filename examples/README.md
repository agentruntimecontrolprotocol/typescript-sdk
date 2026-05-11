# ARCP TypeScript Examples

Two sets:

- **`01-*` … `06-*`** — runnable in-process demos exercising the SDK
  end-to-end against a paired memory transport.
- **Per-primitive directories** — fourteen single-purpose examples,
  each named for the protocol primitive it demonstrates. These mirror
  the Python tree under `python-sdk/examples/`. *Illustrative, not
  runnable* — setup is elided with `null as unknown as ARCPClient`
  so the protocol code reads cleanly.

## The fourteen

| Directory | Demonstrates | Spec |
|---|---|---|
| [`subscriptions/`](./subscriptions) | Three Observer clients on one session, three filters, three sinks. | §5, §13 |
| [`leases/`](./leases) | Lease-gated shell agent. Read leases coarse, write leases scoped. | §15.4–§15.5 |
| [`lease_revocation/`](./lease_revocation) | Per-table leases with `lease.revoked` / `lease.extended` mid-flight. | §15.5 |
| [`permission_challenge/`](./permission_challenge) | Two-party permission challenge — generator asks, reviewer holds veto. | §15.4, §6.4 |
| [`delegation/`](./delegation) | `agent.delegate` fan-out + `JobMux` to demux events by `job_id`. | §14, §6.4 |
| [`handoff/`](./handoff) | `agent.handoff` with transcript packed as artifact, runtime fingerprint pinned. | §14, §16, §8.3 |
| [`heartbeats/`](./heartbeats) | Worker federation; heartbeat-loss reroute via `idempotency_key`. | §10.3, §6.4 |
| [`capability_negotiation/`](./capability_negotiation) | Capability-driven peer routing; standard `cost.usd` rollups. | §7, §17.3.1, §18.3 |
| [`resumability/`](./resumability) | Crash and resume via `process.exit` + `resume` envelope. | §10, §19, §6.4 |
| [`reasoning_streams/`](./reasoning_streams) | `kind: thought` stream + a peer that subscribes and delegates critiques back. | §11.4, §13, §14 |
| [`extensions/`](./extensions) | Custom `arcpx.sdr.*.v1` extension namespace with unknown-message handling. | §21 |
| [`human_input/`](./human_input) | `human.input.request` fanned across phone/email/Slack; first-wins. | §12 |
| [`cancellation/`](./cancellation) | Cooperative `cancel` (terminate) vs `interrupt` (pause and ask). | §10.4–§10.5 |
| [`mcp/`](./mcp) | ARCP runtime fronting an MCP server: `tool.invoke` → MCP `call_tool`. | §20 |

## Conventions

- TypeScript with NodeNext module resolution.
- Each example is one `main.ts` (the protocol code) + 0–2 stub
  modules named for what they elide (`agents.ts`, `steps.ts`,
  `synth.ts`, `cheap.ts`, `work.ts`, `channels.ts`, `sql.ts`,
  `upstream.ts`).
- `null as unknown as ARCPClient` in place of full transport /
  identity / auth construction. Setup boilerplate is not the point.
- Envelopes match RFC-0001 v2 exactly. Custom message types follow
  §21.1 `arcpx.<domain>.<name>.v<n>` naming.
- Where a Python helper like `client.request(env, timeout=...)` or
  `client.events()` doesn't exist on the TS surface, examples use a
  `declare`d shim of the same shape; the protocol code stays
  identical to its Python counterpart.

## Reading order

For a brisk tour: `subscriptions`, `leases`, `delegation`,
`resumability`, `cancellation`, `extensions`, `mcp`. These seven
exercise the bulk of the protocol.
