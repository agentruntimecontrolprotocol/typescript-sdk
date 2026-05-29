# @agentruntimecontrolprotocol/runtime

The runtime/server side. Hosts agents, accepts transports, runs the
session and job machinery, enforces leases.

## Install

```sh
pnpm add @agentruntimecontrolprotocol/runtime @agentruntimecontrolprotocol/core
```

## `ARCPServer`

```ts
import { ARCPServer } from "@agentruntimecontrolprotocol/runtime";
import { StaticBearerVerifier } from "@agentruntimecontrolprotocol/core";

const server = new ARCPServer({
  runtime: { name: "my-runtime", version: "1.0.0" },
  capabilities: { encodings: ["json"], agents: ["echo"] },
  bearer: new StaticBearerVerifier(new Map([["tok", { principal: "me" }]])),
});

server.registerAgent("echo", async (input, ctx) => {
  return { echoed: input };
});

server.accept(transport); // sync: returns SessionContext
```

### `ARCPServerOptions`

| Field                                                  | Default          | Notes                                      |
| ------------------------------------------------------ | ---------------- | ------------------------------------------ |
| `runtime: RuntimeIdentity`                             | —                | `{ name, version }` advertised on welcome. |
| `capabilities: Capabilities`                           | —                | `{ encodings?, agents?, features? }`. Vendor keys round-trip. |
| `bearer?: BearerVerifier`                              | optional         | See [auth guide](../guides/auth.md).       |
| `eventLog?: EventLog`                                  | `new EventLog()` (in-memory SQLite) | Pass `{ path }` for durable resume. |
| `logger?: Logger`                                      | `rootLogger`     | Pino-shaped.                               |
| `heartbeatIntervalSeconds?: number`                    | 30               | v1.1 — interval for `session.ping`.        |
| `resumeWindowSeconds?: number`                         | 600              | §6.3 — buffered-event TTL.                 |
| `cancelGraceMs?: number`                               | 30_000           | §7.4 — grace before forced terminate.      |
| `idempotencyTtlMs?: number`                            | 86_400_000 (24h) | §7.2 — idempotency cache TTL.              |
| `caps?: SessionCaps`                                   | see below        | §14 — per-session DoS caps.                |
| `features?: readonly string[]`                         | `V1_1_FEATURES`  | Advertised feature set.                    |
| `jobAuthorizationPolicy?: (job, principal) => boolean` | same-principal   | Authorization gate.                        |
| `backPressureThreshold?: number`                       | 1000             | v1.1 — unacked-event count that emits `back_pressure` status. |
| `credentialProvisioner?: CredentialProvisioner`        | —                | v1.1 §9.7. Requires `credentialStore`.     |
| `credentialStore?: CredentialStore`                    | —                | v1.1 §9.7. Required when provisioner is set. |

#### `SessionCaps` defaults

```ts
{
  maxBufferedEvents: 10_000,
  maxBufferedBytes: 16 * 1024 * 1024,  // 16 MiB
  maxConcurrentJobs: 100,
}
```

### Methods

#### `accept(transport): SessionContext`

Pair the runtime with a new transport. Synchronous — returns the
`SessionContext` representing that session immediately; the handshake
runs asynchronously on the transport's inbound queue. Most callers
don't touch the returned object (the runtime drives everything), but
it's useful for advanced cases (registering custom envelope handlers
for vendor types, observing state).

#### `registerAgent(name, handler)` / `registerAgentVersion(name, version, handler)` / `setDefaultAgentVersion(name, version)`

```ts
// Unversioned handler (bare `agent: "name"` submits resolve here).
server.registerAgent("name", async (input, ctx) => {
  await ctx.status("running");
  return { ok: true };
});

// v1.1 §7.5 — versioned handlers. `registerAgent` does NOT parse
// `name@version`; use `registerAgentVersion` for each version, then
// optionally `setDefaultAgentVersion` to choose the bare-name target.
server.registerAgentVersion("summarize", "v1", handlerV1);
server.registerAgentVersion("summarize", "v2", handlerV2);
server.setDefaultAgentVersion("summarize", "v2");
```

The handler signature is `(input: unknown, ctx: JobContext) =>
Promise<unknown>`. Throw an `ARCPError` to signal a typed failure;
return a value to signal success.

#### `hasAgent(name)` / `resolveAgent(name, version)` / `getAgentInventory()`

`hasAgent` is a fast existence check. `resolveAgent` parses an
incoming submit (mirroring §7.5 rules; throws
`AgentNotAvailableError` / `AgentVersionNotAvailableError`).
`getAgentInventory` returns the rich `AgentInventoryEntry[]` shape
the runtime advertises on welcome.

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
  // Effect-shaped twins:
  validateLeaseOpEffect,
  validateLeaseConstraintsEffect,
  assertLeaseSubsetEffect,
  assertLeaseConstraintsSubsetEffect,
} from "@agentruntimecontrolprotocol/runtime";
```

`validateLeaseOp({ lease, capability, target, ctx? })` is the core
enforcement check. It takes a single options object — not positional
args — and throws `PermissionDeniedError`, `LeaseExpiredError`, or
`BudgetExhaustedError`. See [leases guide](../guides/leases.md).

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
  // ...
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

## Credential provisioning — v1.1

When `model.use` or other provisioned credentials are in play,
configure both a provisioner and a store:

```ts
import {
  ARCPServer,
  InMemoryCredentialStore,
  toBudgetExhausted,
  type CredentialProvisioner,
  type CredentialIssueContext,
  type IssuedCredential,
  type CredentialStore,
} from "@agentruntimecontrolprotocol/runtime";
```

`ARCPServer` throws at construction if `credentialProvisioner` is set
without a `credentialStore` (§14 — credential revocation reliability).
`InMemoryCredentialStore` is fine for tests; production callers
implement `CredentialStore` against durable storage. See
[credentials guide](../guides/credentials.md).

## Effect surface

```ts
import {
  ARCPRuntimeLayer,
  type ARCPRuntimeLayerOptions,
  ARCPServerService,
  makeARCPServerRuntime,
  acceptSessionEffect,
  resumeSweepDaemon,
  JobService,
  jobLayer,
  JobManagerService,
  jobManagerLayer,
  makeJobEffect,
  makeJobManagerEffect,
  type JobEffect,
  type JobManagerEffect,
  watchdogEffect,
  SessionContextService,
  sessionContextLayer,
  makeSessionContextEffect,
  type SessionContextEffect,
} from "@agentruntimecontrolprotocol/runtime";
```

`makeARCPServerRuntime(options)` returns a `ManagedRuntime` that
provisions `ARCPServerService`. `acceptSessionEffect(transport)` is
the Effect-shaped twin of `server.accept`; `resumeSweepDaemon`
replaces the legacy `setInterval`-based sweep. `JobService`,
`JobManagerService`, and `SessionContextService` are the per-job /
per-session Effects driven internally by the runtime.

## Source

[`packages/runtime/src/`](../../packages/runtime/src/) — the runtime
is split across multiple modules:

- `server.ts` — `ARCPServer` (sessions, agent registry, handshake)
- `session-context.ts` — per-session state machine
- `job.ts` / `job-context.ts` / `job-runner.ts` — job lifecycle
- `agent-registry.ts` — versioned agent resolution
- `lease.ts` — `validateLeaseOp` and friends
- `credential-provisioner.ts` / `credential-store.ts` — §9.7
- `server-resume.ts` / `server-subscribe.ts` — §6.3 / §6.6 / §7.6
- `server-effect.ts` / `job-effect.ts` / `lease-effect.ts` /
  `session-effect.ts` — Effect-shaped twins
- `types.ts`, `stores.ts`, `index.ts`
