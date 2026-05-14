# ARCP — Agent Runtime Control Protocol (TypeScript reference)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](#)
[![ARCP](https://img.shields.io/badge/arcp-v1.0-orange.svg)](../spec/docs/draft-arcp-02.md)

Reference implementation of [ARCP v1.0](../spec/docs/draft-arcp-02.md), the
Agent Runtime Control Protocol — a small wire protocol for letting an
agent talk to the runtime that hosts it. ARCP is intentionally narrow:
sessions, jobs, immutable per-job leases, a single event stream with
eight reserved kinds, and a resume token for reconnects. Everything
else (human-in-the-loop, checkpointing, subscriptions, scheduled jobs)
is delegated to companion protocols.

This repository is a **pnpm workspace** of independently-versioned
packages, all ESM, all strictly typed against TypeScript 5.6 with
`exactOptionalPropertyTypes`.

## Install

| Install | When to use |
|---|---|
| `@arcp/sdk` | "Give me everything." Re-exports core + client + runtime, ships the `arcp` CLI. |
| `@arcp/core` | Shared primitives only — envelopes, errors, messages, transports, event log, auth, session state. |
| `@arcp/client` | Build a client that talks to an ARCP runtime. Depends on `@arcp/core`. |
| `@arcp/runtime` | Build a runtime/server that hosts agents. Depends on `@arcp/core`. |

```sh
pnpm add @arcp/sdk
# or, à la carte:
pnpm add @arcp/client @arcp/runtime @arcp/core
```

Optional middleware:

| Package | What it does |
|---|---|
| `@arcp/node` | Attach the ARCP WebSocket upgrade to an existing Node `http.Server`. |
| `@arcp/express` | Express app helper + WS upgrade attachment, with Host-header DNS-rebind protection. |
| `@arcp/hono` | Hono app helper + WS upgrade attachment for `@hono/node-server`. |
| `@arcp/middleware-otel` | Emit OpenTelemetry spans and propagate W3C trace context per §11. |

## Quickstart

A complete client + runtime in 40 lines (from
[`examples/submit-and-stream.ts`](./examples/submit-and-stream.ts)):

```ts
import {
  ARCPClient,
  ARCPServer,
  pairMemoryTransports,
  StaticBearerVerifier,
} from "@arcp/sdk";

const TOKEN = "tok-demo";

const server = new ARCPServer({
  runtime: { name: "demo-runtime", version: "1.0.0" },
  capabilities: { encodings: ["json"], agents: ["echo"] },
  bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
});

// §7.1 Agents are registered by name; handlers receive `(input, ctx)`.
server.registerAgent("echo", async (input, ctx) => {
  await ctx.log("info", "received");
  return { echoed: input };
});

const [c, s] = pairMemoryTransports();
server.accept(s);

const client = new ARCPClient({
  client: { name: "demo-client", version: "1.0.0" },
  authScheme: "bearer",
  token: TOKEN,
});

await client.connect(c);
const handle = await client.submit({ agent: "echo", input: { hi: 1 } });
const result = await handle.done;
// → { final_status: "success", result: { echoed: { hi: 1 } } }

await client.close();
await server.close();
```

## Core concepts

### Envelopes (§5)

Every message on the wire is a JSON object with these required fields:

| Field | Meaning |
|---|---|
| `arcp` | Protocol version. v1.0 is the literal string `"1"`. |
| `id` | Unique message id (ULID/UUIDv7). |
| `type` | Message type discriminator (e.g., `"job.submit"`). |
| `session_id` | REQUIRED on every envelope after `session.welcome`. |
| `payload` | Type-specific body. |
| `event_seq` | REQUIRED on `job.event`/`job.result`/`job.error` — strictly monotonic per session. |
| `job_id` | REQUIRED on every job-scoped envelope. |
| `trace_id` | OPTIONAL W3C 32-hex trace id for OTel propagation. |
| `extensions` | OPTIONAL `x-vendor.*`-namespaced extension object. |

Anything else on the wire is ignored. Unknown `x-vendor.*` types are
round-tripped per §15.

### Sessions (§6)

Three-message handshake:

```
C → R   session.hello   { client, auth, capabilities?, resume? }
R → C   session.welcome { runtime, capabilities, resume_token, resume_window_sec }
        — or —
R → C   session.error   { code, message }   (transport then closes)
```

Either side may end the session with `session.bye { reason? }`. The
`resume_token` is single-use: every `session.welcome` rotates it (§6.2).
A session.hello with `payload.resume` resumes a prior session by
session_id and replays events with `event_seq > last_event_seq` (§6.3).

### Jobs (§7)

One verb, one job:

```
C → R   job.submit   { agent, input, lease_request?, idempotency_key?, max_runtime_sec? }
R → C   job.accepted { job_id, lease, accepted_at, ... }
R → C   job.event[…] (one or more)
R → C   job.result   { final_status: "success", result?, summary? }
        — or —
R → C   job.error    { final_status: "error"|"cancelled"|"timed_out", code, message, ... }
```

States: `pending → running → {success|error|cancelled|timed_out}` (§7.3).
The `final_status` is on the terminal event, not a separate verb.

Cancellation is a single path: `job.cancel { reason? }`. Runtime
signals the agent and applies a 30-second grace before forced
termination (§7.4).

### Job events (§8)

Every event the runtime emits to the client is one `job.event` envelope
whose `payload.kind` is one of eight reserved values or a vendor
`x-vendor.*` extension:

| Kind | Body shape | Purpose |
|---|---|---|
| `log` | `{ level, message, attributes? }` | Plain log line. |
| `thought` | `{ text }` | Model reasoning / internal monologue. |
| `tool_call` | `{ tool, args, call_id }` | Agent invoked a tool. |
| `tool_result` | `{ call_id, result? | error? }` | Result for a `tool_call`. |
| `status` | `{ phase, message? }` | Lifecycle hint (e.g., `running`, `fetching`). |
| `metric` | `{ name, value, unit?, attributes? }` | Numeric measurement. |
| `artifact_ref` | `{ uri, content_type, byte_size?, sha256? }` | Reference to an artifact (storage is out of scope). |
| `delegate` | `{ delegate_id, agent, input, lease_request? }` | Initiate a child job. |

Sequence numbers are session-scoped (§8.3): one counter across all
concurrent jobs in the session. Replay across a resume preserves
monotonicity and is gap-free.

### Leases (§9)

A lease is a JSON object: capability namespace → list of glob patterns.
Reserved namespaces are `fs.read`, `fs.write`, `net.fetch`, `tool.call`,
`agent.delegate`. Custom namespaces MUST use `x-vendor.<vendor>.<cap>`.

Leases are **immutable at submit**. The runtime MAY reduce a
`lease_request`; it MUST NOT expand it. There is no extension, refresh,
or revocation — if more capability is needed, submit a new job.

Glob syntax: `*` matches one segment, `**` matches zero+ segments
(§9.2). Matching is anchored. Paths are canonicalized (`..`/`.`
collapse, scheme lower-cased on URLs) before pattern check (§14).

### Delegation (§10)

A parent agent can spawn a child by emitting a `job.event` of kind
`delegate`. The runtime intercepts that event, validates the child
`lease_request` is a subset of the parent's effective lease, and
issues a fresh `job.accepted` for the child with `parent_job_id` and
`delegate_id` set. The child inherits the parent's `trace_id`. Subset
violation surfaces as a `tool_result` event on the *parent* with code
`LEASE_SUBSET_VIOLATION` (not a session-level error).

### Resume (§6.3)

The runtime advertises `resume_token` and `resume_window_sec` on every
`session.welcome`. To resume a dropped session within the window, the
client re-issues `session.hello` carrying:

```ts
{ resume: { session_id, resume_token, last_event_seq } }
```

The runtime validates the token, rotates it, replays buffered events
strictly greater than `last_event_seq`, and continues live streaming.
Past the window, the resume is rejected with `RESUME_WINDOW_EXPIRED`.

## Running the runtime

### Programmatic

```ts
import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@arcp/sdk";

const server = new ARCPServer({
  runtime: { name: "my-runtime", version: "1.0.0" },
  capabilities: { encodings: ["json"], agents: ["my-agent"] },
  bearer: new StaticBearerVerifier(new Map([["tok", { principal: "me" }]])),
});

server.registerAgent("my-agent", async (input, ctx) => {
  // …
  return { ok: true };
});

const wss = await startWebSocketServer({
  host: "127.0.0.1",
  port: 7777,
  onTransport: (t) => server.accept(t),
});
console.log(`listening on ${wss.url}`);
```

### CLI

The `@arcp/sdk` package ships an `arcp` binary:

```sh
# Run a runtime over WebSocket
pnpm tsx packages/sdk/src/cli.ts serve --host 127.0.0.1 --port 7777 \
  --token tok --principal me@example.com

# Submit a job and print the terminal result
pnpm tsx packages/sdk/src/cli.ts submit \
  --url ws://127.0.0.1:7777 \
  --token tok \
  --agent my-agent \
  --input '{"hi":1}'

# Replay events from a SQLite event log
pnpm tsx packages/sdk/src/cli.ts replay --db arcp.db --session sess_XYZ --after-seq 0
```

Use `--transport stdio` to run as a child process driven by a parent
ARCP client.

## Writing clients

```ts
import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const client = new ARCPClient({
  client: { name: "my-client", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env.TOKEN,
});

const transport = await WebSocketTransport.connect("wss://runtime.example.com/arcp");
const welcome = await client.connect(transport);
console.log("resume_token =", welcome.resume_token);

const handle = await client.submit({
  agent: "weekly-report",
  input: { week: "2026-W19" },
  lease: { "net.fetch": ["s3://example/**"] },
  idempotencyKey: "weekly-report-2026-W19",
});

client.on("job.event", (env) => {
  if (env.type === "job.event") {
    console.log(`[${env.event_seq}] ${env.payload.kind}`, env.payload.body);
  }
});

const result = await handle.done;
console.log("done:", result);
await client.close();
```

## Conformance

The SDK is intended to be 100% conforming to ARCP v1.0. Section-by-section
status lives in [`CONFORMANCE.md`](./CONFORMANCE.md).

Spec sections implemented:

- §4 Transport (WebSocket, stdio)
- §5 Wire format (envelope, version `"1"`, ULID ids, `event_seq`, `trace_id`)
- §6 Sessions (hello / welcome / error / bye / resume)
- §7 Jobs (submit / accepted / event / result / error / cancel)
- §8 Job events (8 reserved kinds + `x-vendor.*`)
- §9 Leases (immutable per-job, glob matching, canonicalization)
- §10 Delegation (subset validation, trace inheritance)
- §11 Trace propagation (W3C trace context via OTel middleware)
- §12 Error taxonomy (12 codes)
- §14 Security (resume-window sweep, per-session DoS caps)
- §15 Vendor extension namespace (`x-vendor.*`)

## Examples

Five runnable scripts demonstrating §13.1–§13.5. See
[`examples/README.md`](./examples/README.md):

| Example | Spec |
|---|---|
| `submit-and-stream.ts` | §13.1 |
| `delegate/` (server + client) | §13.2 / §10 |
| `resume.ts` | §13.3 / §6.3 |
| `idempotent-retry.ts` | §13.5 / §7.2 |
| `lease-violation.ts` | §13.4 / §9.3 |

## Repository layout

```
packages/
  core/                # @arcp/core — envelope, errors, messages, transport, store, auth, state
  client/              # @arcp/client — ARCPClient
  runtime/             # @arcp/runtime — ARCPServer, Job, JobContext, Lease helpers
  sdk/                 # @arcp/sdk — meta-package, ships the `arcp` CLI
  middleware/
    node/              # @arcp/node — Node http.Server WS upgrade
    express/           # @arcp/express
    hono/              # @arcp/hono
    otel/              # @arcp/middleware-otel
examples/              # Runnable §13.1–§13.5 demos
```

## Development

```sh
pnpm install
pnpm typecheck   # tsc --noEmit per package
pnpm lint        # biome check .
pnpm test        # vitest run per package
pnpm build       # tsc -b across all packages
```

## License

[Apache-2.0](./LICENSE).
