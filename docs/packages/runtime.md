# @arcp/runtime

The runtime/server side. Hosts agents, accepts transports, runs the
session and job machinery, enforces leases.

## Install

```sh
pnpm add @arcp/runtime @arcp/core
```

## `ARCPServer`

```ts
import { ARCPServer, StaticBearerVerifier } from "@arcp/runtime";

const server = new ARCPServer({
  runtime: { name: "my-runtime", version: "1.0.0" },
  capabilities: { encodings: ["json"], agents: ["echo"] },
  bearer: new StaticBearerVerifier(new Map([["tok", { principal: "me" }]])),
});

server.registerAgent("echo", async (input, ctx) => {
  return { echoed: input };
});

await server.accept(transport);
```

### `ARCPServerOptions`

| Field                                                  | Default          | Notes                                      |
| ------------------------------------------------------ | ---------------- | ------------------------------------------ |
| `runtime: RuntimeIdentity`                             | —                | `{ name, version }` advertised on welcome. |
| `capabilities: Capabilities`                           | —                | `{ encodings, agents, extensions? }`.      |
| `bearer?: BearerVerifier`                              | required in v1.0 | See [auth guide](../guides/auth.md).       |
| `eventLog?: EventLog`                                  | in-memory        | Drop-in for durable resume.                |
| `logger?: Logger`                                      | `rootLogger`     | Pino-shaped.                               |
| `heartbeatIntervalSeconds?: number`                    | 30               | v1.1 — interval for `session.heartbeat`.   |
| `resumeWindowSeconds?: number`                         | 600              | §6.3 — buffered-event TTL.                 |
| `cancelGraceMs?: number`                               | 30_000           | §7.4 — grace before forced terminate.      |
| `idempotencyTtlMs?: number`                            | 86_400_000 (24h) | §7.2 — idempotency cache TTL.              |
| `caps?: SessionCaps`                                   | see below        | §14 — per-session DoS caps.                |
| `features?: readonly string[]`                         | `V1_1_FEATURES`  | Advertised feature set.                    |
| `jobAuthorizationPolicy?: (job, principal) => boolean` | same-principal   | Authorization gate.                        |
| `backPressureThreshold?: number`                       | 1000             | v1.1 — unacked events before stall.        |

#### `SessionCaps` defaults

```ts
{
  maxBufferedEvents: 10_000,
  maxBufferedBytes: 16 * 1024 * 1024,  // 16 MiB
  maxConcurrentJobs: 100,
}
```

### Methods

#### `accept(transport): Promise<SessionContext>`

Pair the runtime with a new transport. Returns the `SessionContext`
representing that session. Most callers don't touch the returned
object — it's driven internally — but it's useful for advanced cases
(registering custom envelope handlers, observing state).

#### `registerAgent(name, handler)`

```ts
server.registerAgent("name", async (input, ctx) => {
  await ctx.status("running");
  return { ok: true };
});
```

The handler signature is `(input: unknown, ctx: JobContext) =>
Promise<unknown>`. Throw an `ARCPError` to signal a typed failure;
return a value to signal success.

For versioned agents:

```ts
server.registerAgent("summarize@v1", handlerV1);
server.registerAgent("summarize@v2", handlerV2);
// Defaults to the latest registered version when client omits @version.
```

#### `subscribers` — v1.1

`Map<JobId, Set<SessionContext>>` — tracks which sessions are
subscribed to which jobs. Read-only externally; the runtime maintains
it.

#### `eventLog`

Direct access to the event log instance, useful for replay tools and
admin endpoints.

## `JobContext`

Handed to agent handlers. The agent's window into the runtime.

```ts
type JobContext = {
  readonly jobId: JobId;
  readonly sessionId: SessionId;
  readonly agent: string;
  readonly agentVersion: string | null;     // v1.1
  readonly agentRef: string;                // e.g. "summarize@v2"
  readonly lease: Lease;
  readonly leaseConstraints?: LeaseConstraints; // v1.1
  readonly budget: ReadonlyMap<string, number>; // v1.1
  readonly traceId?: TraceId;
  readonly signal: AbortSignal;             // fires on cancel/timeout
  readonly logger: Logger;                  // bound to session+job

  // Event emission (one per kind):
  log(level, message, attributes?): Promise<void>;
  thought(text): Promise<void>;
  status(phase, message?): Promise<void>;
  metric(metric: MetricPayload): Promise<void>;
  toolCall(body: ToolCallBody): Promise<void>;
  toolResult(body: ToolResultBody): Promise<void>;
  artifactRef(body: ArtifactRefBody): Promise<void>;
  delegate(body: DelegateBody): Promise<void>;

  // v1.1 sugar:
  progress(current, opts): Promise<void>;
  resultChunk(body): Promise<void>;
  streamResult({ resultId? }): ResultStream;

  // Vendor extensions:
  emitEvent(kind: string, body: unknown): Promise<void>;
};
```

See [job-events guide](../guides/job-events.md) for body shapes and
patterns.

## `ResultStream` — v1.1

For chunked result emission (§8.4).

```ts
const stream = ctx.streamResult({});
for await (const chunk of source) {
  await stream.write(chunk, { encoding: "utf8" });
}
await stream.finalize(undefined, { summary, resultSize });
```

`finalize()` emits the terminal `job.result` and closes the stream.
Don't return from the handler after calling `finalize()` — the result
is already on the wire.

## `Job`

The value object for one in-flight job. Most callers don't interact
with it directly; the runtime exposes it on `SessionContext.jobs` for
authorization policies and listing.

```ts
type Job = {
  readonly jobId: JobId;
  readonly sessionId: SessionId;
  readonly agent: string;
  readonly agentVersion: string | null;
  readonly agentRef: string;
  readonly lease: Lease;
  readonly leaseConstraints?: LeaseConstraints;
  readonly parentJobId?: JobId; // delegate child
  readonly delegateId?: string;
  readonly traceId?: TraceId;
  readonly createdAt: string; // ISO timestamp
  readonly budget: Map<string, number>; // mutable
  submitterPrincipal?: string;
  state:
    | "pending"
    | "running"
    | "success"
    | "error"
    | "cancelled"
    | "timed_out";
  readonly signal: AbortSignal;
  readonly isTerminal: boolean;
};
```

## Lease utilities

```ts
import {
  compileGlob,
  matchGlob,
  canonicalizeTarget,
  assertLeaseSubset,
  assertLeaseConstraintsSubset,
  isLeaseSubset,
  validateLeaseShape,
  validateLeaseOp,
  validateLeaseConstraints,
  isValidCapabilityName,
  isReservedCapabilityName,
  initialBudgetFromLease,
} from "@arcp/runtime";
```

`validateLeaseOp(lease, capability, target, ctx?)` is the core
enforcement check; throws `PermissionDeniedError`,
`LeaseExpiredError`, or `BudgetExhaustedError`. See
[leases guide](../guides/leases.md).

## `SessionContext`

Per-session state owned by the runtime. Most callers don't touch it —
the server class drives everything. Useful entry points:

| Field/method                     | Use                                       |
| -------------------------------- | ----------------------------------------- |
| `state: SessionState`            | Phase machine.                            |
| `jobs: JobManager`               | Live job tracking.                        |
| `pending: PendingRegistry`       | Pending request map.                      |
| `nextEventSeq()`                 | Allocate next session-scoped seq.         |
| `registerHandler(type, handler)` | Custom envelope handler (vendor types).   |
| `send(envelope)`                 | Direct emission (fan-out to subscribers). |
| `emitSessionError(err)`          | Force-close with `session.error`.         |
| `emitJobError(jobId, payload)`   | Force-terminate a job.                    |
| `negotiatedFeatures: string[]`   | Effective v1.1 set.                       |
| `lastAckedEventSeq`              | v1.1 back-pressure tracking.              |

## Job authorization

Default: same-principal-only. Override to permit shared access:

```ts
new ARCPServer({
  // …
  jobAuthorizationPolicy: (job, principal) => {
    if (job.submitterPrincipal === principal) return true;
    if (
      sharedTenants.has(job.submitterPrincipal!) &&
      sharedTenants.has(principal!)
    )
      return true;
    return false;
  },
});
```

The policy runs on `job.cancel`, `subscribe`, and `list_jobs` access
checks.

## Source

[`packages/runtime/src/`](../../packages/runtime/src/) — five files:
`server.ts`, `job.ts`, `lease.ts`, `types.ts`, `index.ts`.
