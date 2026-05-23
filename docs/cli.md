# CLI

The `@agentruntimecontrolprotocol/sdk` package ships an `arcp` binary. It's a thin
operational tool for running runtimes, submitting jobs, and inspecting
event logs.

## Install

```sh
pnpm add @agentruntimecontrolprotocol/sdk
# or globally:
pnpm add -g @agentruntimecontrolprotocol/sdk
```

If you've cloned the monorepo, the binary is at
[`packages/sdk/src/cli.ts`](../packages/sdk/src/cli.ts) and can be run
with `pnpm tsx`.

Run `arcp --version` to print the implementation and protocol versions
(e.g., `0.2.0 (protocol 1.1)`).

## `arcp serve`

Start a runtime that accepts a configurable bearer token. Most real
deployments embed `ARCPServer` programmatically; `serve` is for ad-hoc
testing and reproductions, and registers no agents by default — submits
return `AGENT_NOT_AVAILABLE` unless you wire your own server.

```sh
arcp serve \
  --host 127.0.0.1 \
  --port 7777 \
  --token tok \
  --principal me@example.com
```

Flags:

| Flag                      | Default          | Notes                                                                   |
| ------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `--transport <ws\|stdio>` | `ws`             | `stdio` makes this a subprocess agent.                                  |
| `--host <host>`           | `127.0.0.1`      | Bind address for WebSocket.                                             |
| `--port <port>`           | `0` (ephemeral)  | Bind port for WebSocket. The bound URL is printed to stdout.            |
| `--token <token>`         | `tok`            | Static bearer accepted by the verifier.                                 |
| `--principal <id>`        | `anonymous`      | Principal returned when the token verifies.                             |
| `--db <path>`             | `:memory:`       | SQLite event log path. Defaults to an in-memory log (not persisted).    |

`startWebSocketServer` accepts every connection on the root path; there
is no `--path` flag. For path-routed mounts on an existing `http.Server`
use [`attachArcpUpgrade`](./packages/node.md) instead.

## `arcp submit`

Submit one job and print the terminal result. Useful in shell scripts
and CI.

```sh
arcp submit \
  --url ws://127.0.0.1:7777 \
  --token tok \
  --agent my-agent \
  --input '{"hi":1}' \
  --idempotency-key run-2026-W19
```

Flags:

| Flag                      | Notes                                                   |
| ------------------------- | ------------------------------------------------------- |
| `--url <ws-url>`          | Required. Runtime WebSocket URL.                        |
| `--token <token>`         | Required. Bearer token.                                 |
| `--agent <name>`          | Required. Registered agent name (`name` or `name@ver`). |
| `--input <json>`          | Inline JSON payload. Default `{}`.                      |
| `--idempotency-key <key>` | Optional dedupe key (§7.2).                             |
| `--max-runtime <sec>`     | Hard wall clock for the job, in seconds.                |

Stdout receives the final `job.result` / `job.error` payload as JSON.
The process exits non-zero on submission failure or a rejected promise.
Per-event streaming is not built into the CLI; for that, use the SDK
programmatically and register `client.on("job.event", ...)`.

For richer submit flags (lease, lease constraints, trace id, file
input), drive `ARCPClient` directly — the CLI is intentionally minimal.

## `arcp replay`

Dump events from a SQLite event log. Useful for postmortems and for
testing resume behavior offline.

```sh
arcp replay \
  --db arcp.db \
  --session sess_01J4XY... \
  --after-seq 0
```

Flags:

| Flag              | Notes                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| `--db <path>`     | Required. SQLite event log to read (opened read-only).                  |
| `--session <id>`  | Required. Filter to a specific session.                                 |
| `--after-seq <n>` | Start strictly after this `event_seq`. Default `0`.                     |

Events are printed one envelope per line as JSON, oldest first.

## `arcp manifest`

Print the CLI's package manifest (name, implementation version, and
protocol version) as JSON. Useful for tooling that needs to assert the
on-disk binary matches an expected version.

```sh
arcp manifest
# → { "name": "arcp", "version": "0.2.0", "protocol_version": "1.1" }
```

## stdio

`--transport stdio` makes `arcp serve` read envelopes from stdin and
write them to stdout. The runtime is the child; the parent process is
the ARCP client. Pipe agent logs to stderr or silence them — any
non-envelope byte on stdout will crash the channel. On startup the
child writes a single readiness line (`arcp serve: stdio transport
ready`) to **stderr**, not stdout, so the wire stays clean.

```ts
// In a parent process:
import { spawn } from "node:child_process";
import { StdioTransport } from "@agentruntimecontrolprotocol/sdk";

const child = spawn("arcp", [
  "serve", "--transport", "stdio",
  "--token", "tok", "--principal", "me",
]);
const transport = new StdioTransport({
  input: child.stdout,
  output: child.stdin,
});
```

See [transports.md#stdio](./transports.md#stdio) for the full pattern.
