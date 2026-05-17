# @arcp/hono

Hono integration for `@hono/node-server`. Provides a starter Hono app
and a WS upgrade attachment helper.

## Install

```sh
pnpm add @arcp/hono @arcp/runtime @hono/node-server
```

## Use

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { ARCPServer } from "@arcp/runtime";
import { createArcpHonoApp, attachArcpToHono } from "@arcp/hono";

const app: Hono = createArcpHonoApp({
  allowedHosts: ["arcp.example.com"],
});

app.get("/healthz", (c) => c.text("ok"));

const httpServer = serve({ fetch: app.fetch, port: 3000 });

const arcp = new ARCPServer({
  /* … */
});

attachArcpToHono(httpServer, {
  path: "/arcp",
  allowedHosts: ["arcp.example.com"],
  onTransport: (t) => arcp.accept(t),
});
```

## API

### `createArcpHonoApp(options?)`

```ts
function createArcpHonoApp(options?: CreateArcpHonoAppOptions): Hono;
```

Returns a fresh `Hono` instance with optional Host validation
middleware. Skip this if you already have a Hono app — call
`attachArcpToHono` against the resulting `http.Server`.

#### `CreateArcpHonoAppOptions`

| Field                              | Notes                             |
| ---------------------------------- | --------------------------------- |
| `allowedHosts?: readonly string[]` | Validate `Host` on every request. |

### `attachArcpToHono(server, options)`

Thin wrapper around `attachArcpUpgrade` from [`@arcp/node`](./node.md).

| Field                                   | Notes                      |
| --------------------------------------- | -------------------------- |
| `path?: string`                         | Defaults to `"/arcp"`.     |
| `allowedHosts?: readonly string[]`      | DNS-rebind protection.     |
| `onTransport: (transport, req) => void` | Pair with `server.accept`. |

## Bun + Hono

If you're running Hono under Bun, prefer [`@arcp/bun`](./bun.md) —
it's a Bun-native listener built on `Bun.serve({ websocket })` and
side-steps the Node `http.Server` shape entirely.

## Source

[`packages/middleware/hono/src/`](../../packages/middleware/hono/src/).
