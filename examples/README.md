# ARCP TypeScript Examples

Seventeen end-to-end examples covering ARCP v1.0 and v1.1. Each one
is a pair of two processes — a runtime (`server.ts`) and a client
(`client.ts`) — that talk over a real `Transport`. No mocks. No
in-memory shortcuts. Each example exits 0 on success.

### v1.0 core

| Example | Demonstrates | Spec |
|---|---|---|
| [`submit-and-stream/`](./submit-and-stream/) | One-shot job. The agent emits 7 of 8 reserved event kinds (status, log, thought, metric, tool_call, tool_result, artifact_ref) and the client streams them to stdout. | §13.1, §7.1, §8.2 |
| [`delegate/`](./delegate/) | Parent agent delegates a child job via a `delegate` event; child inherits `trace_id`; child lease is a subset of parent. | §13.2, §10 |
| [`resume/`](./resume/) | Disconnect mid-stream and resume the same session; runtime replays events with `event_seq > last_event_seq`; fresh `resume_token` rotated. | §13.3, §6.3 |
| [`idempotent-retry/`](./idempotent-retry/) | Same `(principal, idempotency_key)` returns the same `job_id`; same key + different agent yields `DUPLICATE_KEY`. | §13.5, §7.2 |
| [`lease-violation/`](./lease-violation/) | An out-of-lease tool call surfaces as a `tool_result` carrying `PERMISSION_DENIED`; the job continues and succeeds. | §13.4, §9.3 |
| [`cancel/`](./cancel/) | Client submits a long-running job and sends `job.cancel`; the agent observes `ctx.signal`, exits, and the runtime emits `job.error { final_status: "cancelled" }`. | §7.4 |
| [`stdio/`](./stdio/) | The runtime runs as a child subprocess; the client spawns it and talks ARCP over stdin/stdout via `StdioTransport`. Single-command run. | §4.2, §22 |
| [`vendor-extensions/`](./vendor-extensions/) | Agent emits a custom `x-vendor.acme.progress` event kind and declares an `x-vendor.acme.metrics` lease namespace. Client shows both behaviours: a naïve handler that ignores unknown kinds, and a vendor-aware handler that renders the custom kind. | §8.2, §9.2, §15 |

### v1.1 features

| Example | Demonstrates | Spec |
|---|---|---|
| [`heartbeat/`](./heartbeat/) | `session.ping` / `session.pong` keepalive; runtime declares `heartbeat_interval_sec` in `session.welcome`. | §6.4 |
| [`ack-backpressure/`](./ack-backpressure/) | `session.ack` flow control; runtime detects consumer lag and emits a `status { phase: "back_pressure" }` event. | §6.5, §8.2 |
| [`list-jobs/`](./list-jobs/) | `session.list_jobs` read-only inventory with status filter + pagination via `next_cursor`. | §6.6 |
| [`subscribe/`](./subscribe/) | Two clients on the same principal: one submits, the other discovers via `list_jobs`, subscribes with `history: true`, replays + tails live; cross-session cancel is denied with `PERMISSION_DENIED`. | §7.6, §6.6 |
| [`agent-versions/`](./agent-versions/) | `name@version` grammar; default-version resolution for bare names; `AGENT_VERSION_NOT_AVAILABLE` on unregistered version. | §7.5, §12 |
| [`lease-expires-at/`](./lease-expires-at/) | `lease_constraints.expires_at` deadline; agent's `validateLeaseOp` and runtime watchdog both trip `LEASE_EXPIRED`. | §9.5, §12 |
| [`cost-budget/`](./cost-budget/) | `cost.budget` lease capability; `cost.*` metrics auto-decrement the counter; runtime emits debounced `cost.budget.remaining`; final call hits `BUDGET_EXHAUSTED`. | §9.6, §12 |
| [`progress/`](./progress/) | `progress` event kind; client renders a text progress bar. | §8.2.1 |
| [`result-chunk/`](./result-chunk/) | `ctx.streamResult()` writes ~30 chunks; terminal `job.result` carries `result_id` + `result_size`; client `handle.collectChunks()` reassembles. | §8.4 |

## Running

Each example is two terminals (or processes), with one exception:

```sh
# Terminal 1:
pnpm tsx examples/<dir>/server.ts

# Terminal 2:
pnpm tsx examples/<dir>/client.ts
```

The `stdio/` example is single-command — the client spawns its own
runtime as a child:

```sh
pnpm tsx examples/stdio/client.ts
```

Each example's `README.md` documents the demonstration, the spec
sections it touches, and the env vars (`ARCP_DEMO_PORT`,
`ARCP_DEMO_URL`, `ARCP_DEMO_TOKEN`). Default ports are unique so
multiple examples can run simultaneously.

## Conventions

- TypeScript with NodeNext module resolution.
- Each example is a self-contained directory: `server.ts`, `client.ts`,
  `README.md`. No shared fixtures.
- Runtime and client run as separate Node processes, talking either
  over WebSocket (loopback) or stdio (parent/child pipe). This matches
  how production deployments actually look.
- Code is intentionally minimal — the SDK provides the heavy lifting
  (`ARCPServer`, `ARCPClient`, the transports). Each example adds one
  small agent and one demonstration assertion.
