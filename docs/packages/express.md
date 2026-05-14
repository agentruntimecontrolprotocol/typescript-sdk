# @arcp/express

Express integration: a pre-configured `Express` app and a WS upgrade
attachment helper that defaults to DNS-rebind protection.

## Install

```sh
pnpm add @arcp/express @arcp/runtime
```

## Use

```ts
import { createServer } from "node:http";
import { ARCPServer } from "@arcp/runtime";
import { createArcpExpressApp, attachArcpToExpress } from "@arcp/express";

const app = createArcpExpressApp({
  allowedHosts: ["arcp.example.com"],
});

app.get("/healthz", (_req, res) => res.send("ok"));

const httpServer = createServer(app);
const arcp = new ARCPServer({ /* … */ });

attachArcpToExpress(httpServer, {
  path: "/arcp",
  allowedHosts: ["arcp.example.com"],
  onTransport: (t) => arcp.accept(t),
});

httpServer.listen(3000);
```

## API

### `createArcpExpressApp(options?)`

```ts
function createArcpExpressApp(
  options?: CreateArcpExpressAppOptions,
): Express;
```

Returns a fresh Express app with sane defaults:

- `x-powered-by` removed.
- Optional Host validation middleware.

Most apps that already exist as Express can skip this and just call
`attachArcpToExpress` on their existing `http.Server`.

#### `CreateArcpExpressAppOptions`

| Field | Default | Notes |
| --- | --- | --- |
| `disablePoweredBy?: boolean` | `true` | Strip `X-Powered-By: Express`. |
| `allowedHosts?: readonly string[]` | none | Validate `Host` on every request. |

### `attachArcpToExpress(server, options)`

Thin wrapper around `attachArcpUpgrade` from
[`@arcp/node`](./node.md). Accepts the same options:

| Field | Notes |
| --- | --- |
| `path?: string` | Defaults to `"/arcp"`. |
| `allowedHosts?: readonly string[]` | Recommended for public servers. |
| `onTransport: (transport, req) => void` | Pair the transport with `server.accept`. |

Returns an `ArcpUpgradeHandle` with `close()`.

## When to use this vs `@arcp/node`

Use `@arcp/express` when:

- You're already running Express and want `Host` validation applied
  to both HTTP requests and the WS upgrade.
- You want `createArcpExpressApp` as a starting point.

Use [`@arcp/node`](./node.md) directly when:

- Your HTTP framework is something else (Fastify, Hono, Koa) and
  you're just borrowing the upgrade helper.
- You want to wire upgrade behavior manually.

## Source

[`packages/middleware/express/src/`](../../packages/middleware/express/src/).

## Runnable example

[`examples/express/`](../../examples/express/).
