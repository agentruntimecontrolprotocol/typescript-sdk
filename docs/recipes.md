# Recipes

Copy-paste solutions to common problems. Each recipe is a complete,
runnable snippet; full two-process examples for most patterns live in
[`examples/`](../examples/).

## Streaming progress

Emit a structured progress event per step:

```ts
server.registerAgent("batch", async (input, ctx) => {
  for (let i = 0; i < input.items.length; i++) {
    await processOne(input.items[i]);
    await ctx.progress(i + 1, {
      total: input.items.length,
      units: "items",
      message: `processed ${input.items[i].name}`,
    });
  }
  return { ok: true };
});
```

Client side:

```ts
client.on("job.event", (env) => {
  if (env.payload.kind === "status" && env.payload.body.phase === "progress") {
    const { current, total, units, message } = env.payload.body;
    console.log(`${current}/${total} ${units}: ${message}`);
  }
});
```

## Crash-safe submission

Combine idempotency keys with resume so a crashed client recovers
without re-running the agent:

```ts
const key = `weekly-report-2026-W19`;

async function runSafely() {
  const client = new ARCPClient({ /* … */ });
  const transport = await WebSocketTransport.connect("wss://…");
  await client.connect(transport);

  const handle = await client.submit({
    agent: "weekly-report",
    input: { week: "2026-W19" },
    idempotencyKey: key,
  });

  // Persist enough to resume on crash:
  await persistJobState({
    sessionId: client.state.sessionId,
    resumeToken: client.welcomePayload!.resume_token,
    jobId: handle.jobId,
  });

  return await handle.done;
}
```

On restart, look up the persisted state and call `client.resume()`
with `last_event_seq` from your last persisted event. The duplicate
submit collapses to the same `job_id`.

See [resume guide](./guides/resume.md) and [jobs guide](./guides/jobs.md#idempotency-72).

## Retry with backoff

```ts
import { ARCPError, isRetryableByDefault } from "@arcp/core";

async function withRetry<T>(fn: () => Promise<T>, max = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (
        attempt >= max - 1 ||
        !(err instanceof ARCPError) ||
        !isRetryableByDefault(err.code)
      ) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
}

const result = await withRetry(async () => {
  const handle = await client.submit({
    agent: "x",
    input: {},
    idempotencyKey: "key-1",
  });
  return await handle.done;
});
```

## Per-tenant runtime

Isolate tenants by giving each its own `ARCPServer`:

```ts
const runtimes = new Map<string, ARCPServer>();

function getRuntime(tenant: string): ARCPServer {
  let r = runtimes.get(tenant);
  if (!r) {
    r = new ARCPServer({
      runtime: { name: `runtime-${tenant}`, version: "1.0.0" },
      capabilities: { encodings: ["json"], agents: agentsFor(tenant) },
      bearer: bearerVerifierFor(tenant),
      jobAuthorizationPolicy: (job, principal) =>
        principalsInTenant(tenant).has(principal!),
    });
    registerAgents(r, tenant);
    runtimes.set(tenant, r);
  }
  return r;
}

attachArcpUpgrade(httpServer, {
  path: "/arcp",
  onTransport: (t, req) => {
    const tenant = req.url!.split("/")[2]; // /arcp/<tenant>
    getRuntime(tenant).accept(t);
  },
});
```

## Custom auth verifier

```ts
import type { BearerVerifier, BearerIdentity } from "@arcp/core";

class JwtVerifier implements BearerVerifier {
  constructor(private jwks: JwksClient) {}
  async verify(token: string): Promise<BearerIdentity> {
    const decoded = await this.jwks.verify(token, {
      issuer: "https://idp.example.com/",
      audience: "arcp",
    });
    return { principal: decoded.sub };
  }
}

const server = new ARCPServer({
  /* … */,
  bearer: new JwtVerifier(jwks),
});
```

Throw anything to reject the handshake. See
[auth guide](./guides/auth.md).

## Lease enforcement in a custom tool

```ts
import { validateLeaseOp } from "@arcp/runtime";

server.registerAgent("strict-fetcher", async (input, ctx) => {
  // canonical target check (the SDK's net.fetch validator does this)
  validateLeaseOp(ctx.lease, "net.fetch", input.url);
  const res = await fetch(input.url);
  return { status: res.status };
});
```

`validateLeaseOp` throws `PermissionDeniedError` on denial,
`LeaseExpiredError` on expiration, `BudgetExhaustedError` on
exhaustion. See [leases guide](./guides/leases.md).

## In-process client + runtime for tests

```ts
import { ARCPClient, ARCPServer, pairMemoryTransports } from "@arcp/sdk";

async function makePair() {
  const server = new ARCPServer({ /* … */ });
  const [c, s] = pairMemoryTransports();
  await server.accept(s);

  const client = new ARCPClient({ /* … */ });
  await client.connect(c);

  return { client, server, dispose: async () => {
    await client.close();
    await server.close();
  }};
}
```

Used throughout the SDK's own test suite.

## Subprocess agent

Parent (client) spawns a child (runtime over stdio):

```ts
import { spawn } from "node:child_process";
import { StdioTransport } from "@arcp/sdk";

const child = spawn("node", ["./agent.js"], {
  stdio: ["pipe", "pipe", "inherit"], // stderr passes through
});

const transport = new StdioTransport({
  input: child.stdout!,
  output: child.stdin!,
});

const client = new ARCPClient({ /* … */ });
await client.connect(transport);
```

The child must keep stdout strictly to envelopes — pipe its logs to
`stderr`.

## Subscribing to a foreign job (v1.1)

```ts
const sub = await client.subscribe(jobId, { history: true });

client.on("job.event", (env) => {
  if (env.job_id === jobId) handle(env);
});

// later:
await sub.unsubscribe();
```

Requires the `subscribe` feature on both sides. Useful for a
secondary observer (admin UI, audit log).

## Listing jobs (v1.1)

```ts
let cursor: string | null = null;
do {
  const { jobs, nextCursor } = await client.listJobs(
    { state: "running" },
    { limit: 100, cursor: cursor ?? undefined },
  );
  for (const job of jobs) console.log(job.job_id, job.agent);
  cursor = nextCursor;
} while (cursor);
```

## Per-job log correlation

```ts
const log = ctx.logger.child({ trace_id: ctx.traceId });
log.info({ url: input.url }, "fetching");
```

`ctx.logger` is pre-bound to `session_id` and `job_id`. Adding
`trace_id` ties log entries to OTel spans. See
[observability guide](./guides/observability.md).

## Vendor extension event

```ts
// Emit
await ctx.emitEvent("x-vendor.acme.confidence", { score: 0.87 });

// Receive
client.on("job.event", (env) => {
  if (env.payload.kind === "x-vendor.acme.confidence") {
    metrics.observe(env.payload.body.score);
  }
});
```

See [vendor-extensions guide](./guides/vendor-extensions.md).

## Result streaming (v1.1)

Agent:

```ts
const stream = ctx.streamResult({});
for await (const chunk of generate()) {
  await stream.write(chunk, { encoding: "utf8" });
}
await stream.finalize(undefined, { summary: "done" });
```

Client:

```ts
const handle = await client.submit({ agent: "stream-it", input: {} });
const text = await handle.collectChunks();
```

See [job-events guide](./guides/job-events.md#result-streaming-v11-84).
