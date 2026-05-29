<h3 align="center">ARCP TypeScript SDK</h1>

<p align="center"><strong>TypeScript SDK for the Agent Runtime Control Protocol (ARCP) — submit, observe, and control long-running agent jobs from TypeScript.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agentruntimecontrolprotocol/sdk"><img alt="npm" src="https://img.shields.io/npm/v/@agentruntimecontrolprotocol/sdk.svg"></a>
  <a href="https://github.com/agentruntimecontrolprotocol/typescript-sdk/actions/workflows/test.yml"><img alt="CI" src="https://github.com/agentruntimecontrolprotocol/typescript-sdk/actions/workflows/test.yml/badge.svg"></a>
  <a href="https://codecov.io/gh/agentruntimecontrolprotocol/typescript-sdk"><img alt="codecov" src="https://codecov.io/gh/agentruntimecontrolprotocol/typescript-sdk/graph/badge.svg?token=7AK1DZRWGZ"></a>
  <a href="https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md"><img alt="ARCP" src="https://img.shields.io/badge/ARCP-v1.1%20draft-blue"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-lightgrey"></a>
</p>

<p align="center">
  <a href="https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md">Specification</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#installation">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/">Guides</a> ·
  <a href="docs/">API reference</a>
</p>

---

`@agentruntimecontrolprotocol/sdk` is the TypeScript reference implementation of [ARCP](https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md), the Agent Runtime Control Protocol. It covers both sides of the wire — `@agentruntimecontrolprotocol/client` for submitting and observing jobs, `@agentruntimecontrolprotocol/runtime` for hosting agents — so either side can talk to any conformant peer in any language without hand-rolling the envelope, sequencing, or lease enforcement.

ARCP itself is a transport-agnostic wire protocol for long-running AI agent jobs. It owns the parts of agent infrastructure that don't change between products — sessions, durable event streams, capability leases, budgets, resume — and stays out of the parts that do. ARCP wraps the agent function; it does not define how agents are built, how tools are exposed (that's MCP), or how telemetry is exported (that's OpenTelemetry).

## Installation

Requires Node.js 22 or later. The SDK is shipped as a pnpm workspace of independently-versioned, ESM-only packages. Install the meta-package for everything (client, runtime, core types, and the `arcp` CLI), or pick à la carte if you only need one side of the wire:

```sh
npm install @agentruntimecontrolprotocol/sdk
# or, à la carte:
npm install @agentruntimecontrolprotocol/client @agentruntimecontrolprotocol/core            # client side
npm install @agentruntimecontrolprotocol/runtime @agentruntimecontrolprotocol/core           # runtime side
```

Optional host integrations live in separate middleware packages: `@agentruntimecontrolprotocol/node`, `@agentruntimecontrolprotocol/express`, `@agentruntimecontrolprotocol/fastify`, `@agentruntimecontrolprotocol/hono`, `@agentruntimecontrolprotocol/bun`, and `@agentruntimecontrolprotocol/middleware-otel`.

## Quick start

Connect to a runtime, submit a job, stream its events to completion:

```ts
import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const client = new ARCPClient({
  client: { name: "quickstart", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env["ARCP_TOKEN"],
});

const transport = await WebSocketTransport.connect("wss://runtime.example.com/arcp");
await client.connect(transport);

client.on("job.event", (env) => {
  if (env.type !== "job.event") return;
  console.log(`[${env.event_seq}] ${env.payload.kind}`, env.payload.body);
});

const handle = await client.submit({
  agent: "data-analyzer",
  input: { dataset: "s3://example/sales.csv" },
  lease: { "net.fetch": ["s3://example/**"] },
});

const result = await handle.done;
console.log("final:", result.final_status, result.result);
await client.close();
```

This is the whole shape of the SDK: open a session, submit work, consume an ordered event stream, get a terminal result or error. Everything below is detail on those four moves.

## Concepts

ARCP organizes everything around four concerns — **identity**, **durability**, **authority**, and **observability** — expressed through five core objects:

- **Session** — a connection between a client and a runtime. A session carries identity (a bearer token), negotiates a feature set in a `hello`/`welcome` handshake, and is *resumable*: if the transport drops, you reconnect with a resume token and the runtime replays buffered events. Jobs outlive the session that started them. See [§6](https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md).
- **Job** — one unit of agent work submitted into a session. A job has an identity, an optional idempotency key, a resolved agent version, and a lifecycle that ends in exactly one terminal state: `success`, `error`, `cancelled`, or `timed_out`. See [§7](https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md).
- **Event** — the ordered, session-scoped stream a job emits: logs, thoughts, tool calls and results, status, metrics, artifact references, progress, and streamed result chunks. Events carry strictly monotonic sequence numbers so the stream survives reconnects gap-free. See [§8](https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md).
- **Lease** — the authority a job runs under, expressed as capability grants (`fs.read`, `fs.write`, `net.fetch`, `tool.call`, `agent.delegate`, `cost.budget`, `model.use`). The runtime enforces the lease at every operation boundary; a job can never act outside it. Leases may carry a budget and an expiry, and may be subset and handed to sub-agents via delegation. See [§9](https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md).
- **Subscription** — read-only attachment to a job started elsewhere (e.g. a dashboard watching a job a CLI submitted). A subscriber observes the live event stream but cannot cancel or mutate the job. Distinct from *resume*, which continues the original session and carries cancel authority. See [§7.6](https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md).

The SDK models each of these as first-class objects; the rest of this README shows how.

## Guides

### Sessions and resume

Open a session, negotiate features, and reconnect transparently after a transport drop using the resume token — jobs keep running server-side while you're gone.

```ts
import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const client = new ARCPClient({
  client: { name: "resumable", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env["ARCP_TOKEN"],
});

const welcome = await client.connect(
  await WebSocketTransport.connect("wss://runtime.example.com/arcp"),
);
const sessionId = client.state.id!;
const resumeToken = welcome.resume_token;
let lastSeq = 0;
client.on("job.event", (env) => {
  if (env.event_seq !== undefined) lastSeq = env.event_seq;
});

// ... transport drops ...

const client2 = new ARCPClient({
  client: { name: "resumable", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env["ARCP_TOKEN"],
});
await client2.resume(
  await WebSocketTransport.connect("wss://runtime.example.com/arcp"),
  { session_id: sessionId, resume_token: resumeToken, last_event_seq: lastSeq },
);
// The runtime replays every event with seq > lastSeq, then resumes live streaming.
```

### Submitting jobs

Submit a job with an agent (optionally version-pinned as `name@version`), an input, and an optional lease request, idempotency key, and runtime limit.

```ts
const handle = await client.submit({
  agent: "weekly-report@2.1.0",
  input: { week: "2026-W19" },
  lease: { "net.fetch": ["s3://reports/**"] },
  leaseConstraints: { expires_at: new Date(Date.now() + 60_000).toISOString() },
  idempotencyKey: "weekly-report-2026-W19",
  maxRuntimeSec: 300,
});

console.log("job_id =", handle.jobId);
console.log("effective lease =", handle.lease);
console.log("resolved agent =", handle.agent);
```

### Consuming events

Iterate the ordered event stream — `log`, `thought`, `tool_call`, `tool_result`, `status`, `metric`, `artifact_ref`, `progress`, `result_chunk` — and optionally acknowledge progress so the runtime can release buffered events early.

```ts
const client = new ARCPClient({
  client: { name: "ack-demo", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env["ARCP_TOKEN"],
  autoAck: { intervalMs: 250, minSeqDelta: 32 }, // coalesced session.ack
});

client.on("job.event", async (env) => {
  if (env.type !== "job.event") return;
  switch (env.payload.kind) {
    case "log":
      console.log(env.payload.body);
      break;
    case "tool_call":
      console.log("→ tool", env.payload.body);
      break;
    case "metric":
      console.log("metric", env.payload.body);
      break;
    case "progress":
      console.log("progress", env.payload.body);
      break;
  }
  // Or ack manually: await client.ack(env.event_seq!);
});
```

### Leases and budgets

Request capabilities, a budget, and an expiry; read budget-remaining metrics as they arrive; handle the runtime's enforcement decisions.

```ts
const handle = await client.submit({
  agent: "web-research",
  input: { iterations: 8, perCallUSD: 0.3 },
  lease: {
    "tool.call": ["search.*", "fetch.*"],
    "cost.budget": ["USD:1.00"],
  },
  leaseConstraints: { expires_at: new Date(Date.now() + 600_000).toISOString() },
});

console.log("initial budget =", handle.budget);

client.on("job.event", (env) => {
  if (env.type !== "job.event" || env.payload.kind !== "metric") return;
  const m = env.payload.body as { name: string; value: number; unit?: string };
  if (m.name === "cost.budget.remaining") {
    console.log(`budget remaining: ${m.value.toFixed(2)} ${m.unit ?? ""}`);
  }
});

try {
  await handle.done;
} catch (err) {
  // BUDGET_EXHAUSTED or LEASE_EXPIRED is never retryable.
  console.error("job ended:", err);
}
```

### Subscribing to jobs

Attach read-only to a job submitted elsewhere and observe its live stream (with optional history replay) without cancel authority.

```ts
const observer = new ARCPClient({
  client: { name: "dashboard", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env["ARCP_TOKEN"],
});
await observer.connect(await WebSocketTransport.connect("wss://runtime.example.com/arcp"));

observer.on("job.event", (env) => {
  if (env.type !== "job.event") return;
  console.log(`[seq=${env.event_seq}] ${env.payload.kind}`);
});

const listing = await observer.listJobs({ status: ["running"] });
const sub = await observer.subscribe(listing.jobs[0].job_id, { history: true });
console.log(`subscribed from seq=${sub.subscribedFrom} replayed=${sub.replayed}`);

// ... later ...
await sub.unsubscribe();
```

### Error handling

Catch the typed error taxonomy and respect the `retryable` flag — `LEASE_EXPIRED` and `BUDGET_EXHAUSTED` are never retryable; a naive retry fails identically.

```ts
import { ARCPError } from "@agentruntimecontrolprotocol/sdk";

try {
  const handle = await client.submit({ agent: "flaky", input: {} });
  await handle.done;
} catch (err) {
  if (err instanceof ARCPError) {
    if (err.code === "LEASE_EXPIRED" || err.code === "BUDGET_EXHAUSTED") {
      throw err; // resubmit with a fresh lease / budget instead
    }
    if (err.retryable) {
      // safe to retry with backoff (e.g. INTERNAL_ERROR, TIMEOUT)
    }
  }
  throw err;
}
```

## Feature support

ARCP features this SDK negotiates during the `hello`/`welcome` handshake:

| Feature flag | Status |
|---|---|
| `heartbeat` | Supported |
| `ack` | Supported |
| `list_jobs` | Supported |
| `subscribe` | Supported |
| `lease_expires_at` | Supported |
| `cost.budget` | Supported |
| `model.use` | Supported |
| `provisioned_credentials` | Supported |
| `progress` | Supported |
| `result_chunk` | Supported |
| `agent_versions` | Supported |

## Transport

ARCP is transport-agnostic. This SDK ships a WebSocket transport (default), a stdio transport for in-process child runtimes, and an in-memory transport for tests. WebSocket is the default for networked runtimes; stdio is used for in-process child runtimes. Select one by constructing the corresponding `Transport` (`WebSocketTransport.connect(url)`, `new StdioTransport(...)`, `pairMemoryTransports()`) and passing it to `client.connect(transport)`; host integrations under `packages/middleware/*` attach the WebSocket upgrade to Node, Express, Fastify, Hono, or Bun servers.

## API reference

Full API reference — every type, method, and event payload — is in [`docs/`](docs/).

## Versioning and compatibility

This SDK speaks **ARCP v1.1 (draft)**. The SDK follows semantic versioning independently of the protocol; the protocol version it negotiates is shown above and in `session.hello`. A runtime advertising a different ARCP MAJOR is not guaranteed compatible. Feature mismatches degrade gracefully: the effective feature set is the intersection of what the client and runtime advertise, and the SDK will not use a feature outside it.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Protocol questions and proposed changes belong in the [spec repository](https://github.com/agentruntimecontrolprotocol/spec); SDK bugs and feature requests belong here.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
