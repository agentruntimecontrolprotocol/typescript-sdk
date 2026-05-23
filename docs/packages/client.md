# @agentruntimecontrolprotocol/client

The client side of the protocol. One class: `ARCPClient`. Owns one
transport at a time, drives the handshake, dispatches inbound
envelopes to registered handlers, exposes a small public surface for
job submission, cancellation, listing, and subscription.

## Install

```sh
pnpm add @agentruntimecontrolprotocol/client @agentruntimecontrolprotocol/core
```

## Constructor

```ts
import { ARCPClient } from "@agentruntimecontrolprotocol/client";

const client = new ARCPClient({
  client: { name: "my-client", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env.TOKEN,

  // optional:
  capabilities: { encodings: ["json"] },
  features: ["heartbeat", "ack", "list_jobs", "subscribe"],
  logger: myPinoLogger,
  handshakeTimeoutMs: 5000,
  autoAck: { intervalMs: 250, minSeqDelta: 32 },
});
```

### `ARCPClientOptions`

| Field                                       | Required    | Notes                                                 |
| ------------------------------------------- | ----------- | ----------------------------------------------------- |
| `client: ClientIdentity`                    | yes         | `{ name, version }` advertised in `session.hello`.    |
| `authScheme: AuthScheme`                    | yes         | Pinned to `"bearer"` by `AuthSchemeSchema` in v1.1. |
| `token?: string`                            | bearer only | Bearer token.                                         |
| `capabilities?: Capabilities`               | no          | Client-advertised caps.                               |
| `features?: readonly string[]`              | no          | Defaults to `V1_1_FEATURES`.                          |
| `logger?: Logger`                           | no          | Pino-shaped logger.                                   |
| `handshakeTimeoutMs?: number`               | no          | Default 5000.                                         |
| `autoAck?: boolean \| ClientAutoAckOptions` | no          | v1.1 — enables auto-ack.                              |

## Methods

### `connect(transport)`

```ts
const welcome: SessionWelcomePayload = await client.connect(transport);
```

Performs the handshake: sends `session.hello`, awaits
`session.welcome`. Throws `ARCPError` on `session.error` or transport
failure. The returned payload includes `runtime`, `capabilities`,
`resume_token`, `resume_window_sec`, and (when the `heartbeat`
feature negotiated) `heartbeat_interval_sec`. The `session_id` lives
on the envelope, not the payload — read it from `client.state.id`.
Pass `{ signal }` to abort the handshake.

### `resume(transport, resumeInfo)`

```ts
const welcome = await client.resume(transport, {
  session_id,
  resume_token,
  last_event_seq,
});
```

Reconnect to an existing session. Replaces the transport, replays
buffered events strictly after `last_event_seq`, and continues live
streaming. See [resume guide](../guides/resume.md).

### `submit(opts)`

```ts
const handle: JobHandle = await client.submit({
  agent: "x",
  input: {},
  lease: {
    /* ... */
  },
  idempotencyKey: "...",
  maxRuntimeSec: 600,
  traceId: "0123...",
  signal: ac.signal, // optional client-side cancel
  leaseConstraints: {
    /* v1.1 */
  },
});
```

Issues `job.submit`, awaits `job.accepted`, returns a `JobHandle`. See
[jobs guide](../guides/jobs.md) and [leases guide](../guides/leases.md).

### `cancelJob(jobId, opts?)`

```ts
await client.cancelJob(handle.jobId, { reason: "user-cancelled" });
```

Cooperative cancel; the runtime gives the agent 30 seconds to clean
up before forcing the terminal state. See [jobs#cancellation](../guides/jobs.md#cancellation-74).

### `listJobs(filter?, page?)` — v1.1

```ts
const { jobs, nextCursor } = await client.listJobs(
  { agent: "x", status: ["running", "pending"] },
  { limit: 50, cursor: prevCursor },
);
```

`SessionListJobsFilter` supports `status: readonly string[]`,
`agent: string`, `created_after: string`, and `created_before: string`
— all optional. Requires the `list_jobs` feature.

### `subscribe(jobId, opts?)` — v1.1

```ts
const sub = await client.subscribe(jobId, {
  history: true, // include past events
  fromEventSeq: 100, // only events strictly after this seq
});

// stop receiving
await sub.unsubscribe();
```

Attach to a job from a second session. Requires the `subscribe`
feature.

### `ack(seq)` — v1.1

```ts
await client.ack(seq);
```

Manual back-pressure ack. Most callers use `autoAck: true` instead.

### `on(type, handler)`

```ts
client.on("job.event", (env) => {
  /* ... */
});
client.on("job.result", (env) => {
  /* ... */
});
client.on("x-vendor.acme.warmup", (env) => {
  /* ... */
});
```

Register an inbound envelope handler. Handlers are awaited — back-
pressure their work if you need to.

### `send(envelope)`

```ts
await client.send({
  arcp: "1.1",
  id: newMessageId(),
  type: "x-vendor.acme.warmup",
  session_id: client.state.id!,
  payload: { model: "gpt-4o" },
});
```

Direct envelope emission. `client.send()` forwards the envelope
verbatim — it does NOT inject `session_id`, `id`, or `arcp` for you.
Stamp those yourself when constructing the envelope.

### `close(reason?)`

```ts
await client.close("done");
```

Sends `session.bye` and closes the transport. Idempotent.

## Getters

| Getter                                          | Notes                       |
| ----------------------------------------------- | --------------------------- |
| `state: SessionState`                           | The phase machine.          |
| `pending: PendingRegistry`                      | Outstanding request map.    |
| `logger: Logger`                                | Pre-bound to `session_id`.  |
| `lastEventSeqObserved: number`                  | Latest seen `event_seq`.    |
| `welcomePayload: SessionWelcomePayload \| null` | The current welcome.        |
| `negotiatedFeatures: readonly string[]`         | Effective v1.1 feature set. |
| `hasFeature(name): boolean`                     | Convenience.                |

## `JobHandle`

Returned by `submit()`.

| Field                                                      | Notes                                             |
| ---------------------------------------------------------- | ------------------------------------------------- |
| `jobId: JobId`                                             | Server-assigned.                                  |
| `lease: Lease`                                             | The effective lease (possibly narrowed).          |
| `agent?: string`                                           | v1.1 — resolved agent ref including version.      |
| `traceId?: TraceId`                                        | Same id if you passed one in.                     |
| `leaseConstraints?: LeaseConstraints`                      | v1.1 lease constraints (`{ expires_at? }`).       |
| `budget?: ReadonlyMap<string, number>`                     | v1.1 initial per-currency budget.                 |
| `credentials?: readonly IssuedCredential["wire"][]`        | v1.1 provisioned credentials.                     |
| `done: Promise<JobResultPayload>`                          | Resolves on `job.result`, rejects on `job.error`. |
| `collectChunks(): Promise<Buffer \| string>`               | v1.1 — assemble `result_chunk` stream.            |

## `JobSubscription` — v1.1

Returned by `subscribe()`.

| Field                          | Notes                         |
| ------------------------------ | ----------------------------- |
| `jobId: JobId`                 | The target job.               |
| `subscribedFrom: number`       | First `event_seq` returned.   |
| `replayed: boolean`            | Whether history was included. |
| `unsubscribe(): Promise<void>` | End the subscription.         |

## Tree-shaking

The package is ESM-only. No imports pull in `@agentruntimecontrolprotocol/runtime` — a
client-only browser bundle is small (`@agentruntimecontrolprotocol/core` + `@agentruntimecontrolprotocol/client`).

## Effect surface

The package also exports an Effect-native runtime layer for callers
who want to compose the client inside an `Effect`/`Layer` graph:

```ts
import {
  ARCPClientLayer,
  ARCPClientService,
  type ARCPClientServiceShape,
  makeARCPClientRuntime,
  subscribeEnvelopes,
} from "@agentruntimecontrolprotocol/client";
```

`makeARCPClientRuntime(options)` returns a `ManagedRuntime` that
provisions `ARCPClientService`. `subscribeEnvelopes(transport)` is a
`Stream`-based alternative to `client.on("...", handler)` for
Effect-aware consumers.

## Source

[`packages/client/src/`](../../packages/client/src/) —
`client.ts` (the class), `client-dispatch.ts`,
`client-envelopes.ts`, `client-handle.ts`,
`client-effect.ts` (Effect layer + service), `types.ts`,
`index.ts`.
