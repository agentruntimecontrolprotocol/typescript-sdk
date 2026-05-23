# @agentruntimecontrolprotocol/fastify

Fastify integration: attach the ARCP WebSocket upgrade to the
underlying `app.server`. Internally this is a one-line delegation to
[`attachArcpUpgrade`](./node.md) — Fastify's request pipeline is not
consulted for the upgrade. `@fastify/websocket` is declared as a peer
dependency for compatibility, but is not currently used by the
adapter.

## Install

```sh
pnpm add @agentruntimecontrolprotocol/fastify @agentruntimecontrolprotocol/runtime @fastify/websocket
```

## Use

```ts
import Fastify from "fastify";
import { ARCPServer } from "@agentruntimecontrolprotocol/runtime";
import { attachArcpToFastify } from "@agentruntimecontrolprotocol/fastify";

const app = Fastify({ logger: true });
const arcp = new ARCPServer({
  /* ... */
});

app.get("/healthz", async () => "ok");

await app.listen({ host: "0.0.0.0", port: 3000 });

attachArcpToFastify(app, {
  path: "/arcp",
  allowedHosts: ["arcp.example.com"],
  onTransport: (t) => arcp.accept(t),
});
```

Note the call order: `attachArcpToFastify` reads `app.server`, which
is only populated after `app.listen()`.

## API

### `attachArcpToFastify(app, options)`

```ts
function attachArcpToFastify(
  app: FastifyInstance,
  options: AttachArcpUpgradeOptions,
): ArcpUpgradeHandle;
```

Delegates to `attachArcpUpgrade(app.server, options)`. Options match
[`@agentruntimecontrolprotocol/node`](./node.md):

| Field                                   | Notes                           |
| --------------------------------------- | ------------------------------- |
| `path?: string`                         | Defaults to `"/arcp"`.          |
| `allowedHosts?: readonly string[]`      | Validate `Host` on the upgrade. |
| `onTransport: (transport, req) => void` | Pair with `server.accept`.      |

Returns an `ArcpUpgradeHandle`.

## Lifecycle

Detach on shutdown to avoid leaking upgrade listeners during HMR or
hot-reload:

```ts
const handle = attachArcpToFastify(app, {
  /* ... */
});
app.addHook("onClose", async () => {
  await handle.close();
});
```

## Source

[`packages/middleware/fastify/src/`](../../packages/middleware/fastify/src/).

## Runnable example

[`examples/fastify/`](../../examples/fastify/).
