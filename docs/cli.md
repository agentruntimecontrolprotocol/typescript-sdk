# CLI

The `@arcp/sdk` package ships an `arcp` binary. It's a thin
operational tool for running runtimes, submitting jobs, and replaying
event logs.

## Install

```sh
pnpm add @arcp/sdk
# or globally:
pnpm add -g @arcp/sdk
```

If you've cloned the monorepo, the binary is at
[`packages/sdk/src/cli.ts`](../packages/sdk/src/cli.ts) and can be run
with `pnpm tsx`.

## `arcp serve`

Start a runtime that hosts a single named echo-style agent. Most
real deployments embed `ARCPServer` programmatically; `serve` is for
ad-hoc testing and reproductions.

```sh
arcp serve \
  --host 127.0.0.1 \
  --port 7777 \
  --token tok \
  --principal me@example.com
```

Flags:

| Flag                      | Default     | Notes                                             |
| ------------------------- | ----------- | ------------------------------------------------- |
| `--transport <ws\|stdio>` | `ws`        | `stdio` makes this a subprocess agent.            |
| `--host <host>`           | `127.0.0.1` | Bind address for WebSocket.                       |
| `--port <port>`           | `7777`      | Bind port for WebSocket.                          |
| `--path <path>`           | `/arcp`     | URL path for the WS upgrade.                      |
| `--token <token>`         | —           | Required. Static bearer accepted by the verifier. |
| `--principal <id>`        | —           | Principal returned when the token verifies.       |
| `--db <path>`             | none        | If set, persist events to this SQLite file.       |

## `arcp submit`

Submit one job and print the terminal result. Useful in shell scripts
and CI.

```sh
arcp submit \
  --url ws://127.0.0.1:7777/arcp \
  --token tok \
  --agent my-agent \
  --input '{"hi":1}' \
  --idempotency-key run-2026-W19
```

Flags:

| Flag                      | Notes                             |
| ------------------------- | --------------------------------- |
| `--url <ws-url>`          | Runtime URL.                      |
| `--token <token>`         | Bearer token.                     |
| `--agent <name>`          | Registered agent name.            |
| `--input <json>`          | Inline JSON payload.              |
| `--input-file <path>`     | Read payload from a file.         |
| `--idempotency-key <key>` | Optional dedupe key (§7.2).       |
| `--max-runtime-sec <n>`   | Hard wall clock for the job.      |
| `--lease <json>`          | Lease object (§9).                |
| `--trace-id <hex>`        | 32-hex W3C trace id to propagate. |

Stdout receives the final `job.result` payload as JSON; the process
exit code is `0` on `success`, non-zero otherwise. Events are streamed
to stderr in a human-readable form (`[seq] kind message`).

## `arcp replay`

Replay events from a SQLite event log. Useful for postmortems and for
testing resume behavior offline.

```sh
arcp replay \
  --db arcp.db \
  --session sess_01J4XY… \
  --after-seq 0
```

Flags:

| Flag              | Notes                                  |
| ----------------- | -------------------------------------- |
| `--db <path>`     | SQLite event log to read.              |
| `--session <id>`  | Filter to a specific session.          |
| `--job <id>`      | Filter to a specific job.              |
| `--after-seq <n>` | Start strictly after this `event_seq`. |
| `--until-seq <n>` | Stop at this `event_seq`.              |

Events are printed one per line, newest envelope at the bottom.

## stdio

`--transport stdio` makes `arcp serve` read envelopes from stdin and
write them to stdout. The runtime is the child; the parent process is
the ARCP client. Pipe agent logs to stderr or silence them — any
non-envelope byte on stdout will crash the channel.

```sh
# In a parent process:
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

## Exit codes

| Code | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| 0    | Job completed with `final_status: "success"`.             |
| 1    | Runtime/server error (auth, bind failure, unknown agent). |
| 2    | Job terminated with `error`, `cancelled`, or `timed_out`. |
| 64   | Bad CLI arguments.                                        |
