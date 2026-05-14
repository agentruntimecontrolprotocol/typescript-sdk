# ARCP TypeScript Examples

Five end-to-end examples covering ARCP v1.0 §13.1–§13.5. Each runs
in-process against an `ARCPRuntime` + `ARCPClient` paired over an
in-memory transport. No external services are required.

| Example | Demonstrates | Spec |
|---|---|---|
| [`submit-and-stream.ts`](./submit-and-stream.ts) | One-shot job: hello → welcome → submit → events → result. | §13.1 |
| [`delegate/`](./delegate/) | Two-process example. Parent agent delegates a child job via a `delegate` event; child inherits `trace_id`; child lease is a subset of parent. See [`delegate/README.md`](./delegate/README.md). | §13.2, §10 |
| [`resume.ts`](./resume.ts) | Disconnect mid-stream and resume the same session; replay buffered events, fresh `resume_token`, gap-free `event_seq`. | §13.3, §6.3 |
| [`idempotent-retry.ts`](./idempotent-retry.ts) | Same `idempotency_key` returns the same `job_id`; conflicting agent/input yields `DUPLICATE_KEY`. | §13.5, §7.2 |
| [`lease-violation.ts`](./lease-violation.ts) | An out-of-lease tool call surfaces as a `tool_result` carrying `PERMISSION_DENIED`; the job continues. | §13.4, §9.3 |

## Running

```sh
pnpm tsx examples/submit-and-stream.ts
pnpm tsx examples/resume.ts
pnpm tsx examples/idempotent-retry.ts
pnpm tsx examples/lease-violation.ts

# delegation needs two terminals — see delegate/README.md
pnpm tsx examples/delegate/server.ts   # terminal 1
pnpm tsx examples/delegate/client.ts   # terminal 2
```

Each example exits 0 on success. Output is written to stdout; failures
print a stack trace to stderr and exit non-zero.

## Conventions

- TypeScript with NodeNext module resolution.
- Each example is a single self-contained file (no shared fixtures).
- The runtime and client run in the same Node process and communicate
  through paired `MemoryTransport` instances — readable as a tutorial,
  with no transport wiring to distract from the protocol code.
- For production deployments, swap `pairMemoryTransports()` for
  `WebSocketTransport` or `StdioTransport` (see `packages/core/src/transport`).
