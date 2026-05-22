# Getting started

This walks through a minimal ARCP runtime and client. Five minutes,
zero infrastructure. By the end you'll have a job that streams events
back from agent to client.

## Prerequisites

- Node.js **≥ 22**. The SDK is ESM-only and uses native `AbortSignal.any`
  and `WebSocket` from the standard library.
- A package manager that handles workspaces well. The reference repo
  uses **pnpm**, but `npm` and `yarn` work for consumers.

## Install

```sh
pnpm add @agentruntimecontrolprotocol/sdk
```

`@agentruntimecontrolprotocol/sdk` re-exports `@agentruntimecontrolprotocol/core`, `@agentruntimecontrolprotocol/client`, and `@agentruntimecontrolprotocol/runtime`,
and ships the `arcp` CLI. If bundle size matters (typical browser
clients), install just the package you need:

```sh
pnpm add @agentruntimecontrolprotocol/client @agentruntimecontrolprotocol/core
```

## In-process demo (no network)

The fastest path to "I see events flowing" is `pairMemoryTransports()`,
which returns two `Transport` halves that are wired together in memory:

```ts
import {
  ARCPClient,
  ARCPServer,
  pairMemoryTransports,
  StaticBearerVerifier,
} from "@agentruntimecontrolprotocol/sdk";

const TOKEN = "tok-demo";

const server = new ARCPServer({
  runtime: { name: "demo-runtime", version: "1.0.0" },
  capabilities: { encodings: ["json"], agents: ["echo"] },
  bearer: new StaticBearerVerifier(new Map([[TOKEN, { principal: "demo" }]])),
});

server.registerAgent("echo", async (input, ctx) => {
  await ctx.status("running");
  await ctx.log("info", "received", { input });
  return { echoed: input };
});

const [c, s] = pairMemoryTransports();
await server.accept(s);

const client = new ARCPClient({
  client: { name: "demo-client", version: "1.0.0" },
  authScheme: "bearer",
  token: TOKEN,
});

await client.connect(c);

const handle = await client.submit({
  agent: "echo",
  input: { hi: 1 },
});

client.on("job.event", (env) => {
  if (env.type === "job.event") {
    console.log(`[${env.event_seq}] ${env.payload.kind}`, env.payload.body);
  }
});

const result = await handle.done;
console.log("done:", result);
// → { final_status: "success", result: { echoed: { hi: 1 } } }

await client.close();
await server.close();
```

You should see two events (`status: running`, `log: received`) on the
way to the terminal `job.result`.

## Run over WebSocket

Same code, real network. Swap `pairMemoryTransports()` for a WebSocket
server and `WebSocketTransport.connect()`:

```ts
import { startWebSocketServer, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

// server side
const wss = await startWebSocketServer({
  host: "127.0.0.1",
  port: 7777,
  onTransport: (t) => server.accept(t),
});
console.log(`listening on ${wss.url}`); // ws://127.0.0.1:7777/arcp

// client side
const transport = await WebSocketTransport.connect("ws://127.0.0.1:7777/arcp");
await client.connect(transport);
```

For production deployments you'd attach to an existing HTTP server —
see [transports.md](./transports.md) and the
[host-integration middleware](./packages/node.md).

## Run over stdio

Useful for spawning agents as child processes:

```sh
pnpm tsx packages/sdk/src/cli.ts serve --transport stdio
```

The parent process holds the client end of a `StdioTransport`; the child
inherits stdin/stdout and runs the runtime. See
[cli.md](./cli.md#stdio) and [transports.md](./transports.md#stdio).

## What's next

- [Architecture](./architecture.md) — how the parts you just used fit together.
- [Sessions guide](./guides/sessions.md) — the handshake and resume model.
- [Jobs guide](./guides/jobs.md) — submit, stream, cancel, retry.
- [Leases guide](./guides/leases.md) — capability grants per job.

## Runnable examples

Twenty-three end-to-end demos live in [`examples/`](../examples/). Each
is a two-process `server.ts` + `client.ts` pair. Start with:

- [`submit-and-stream/`](../examples/submit-and-stream/) — the example
  above as a runnable two-process script.
- [`resume/`](../examples/resume/) — drop the connection mid-job and
  resume without losing events.
- [`delegate/`](../examples/delegate/) — parent agent spawns a child.
