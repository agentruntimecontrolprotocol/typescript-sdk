# @agentruntimecontrolprotocol/bun

Bun-native ARCP listener built on `Bun.serve({ websocket })`. Skips
the Node `http.Server` shape entirely.

## Install

```sh
bun add @agentruntimecontrolprotocol/bun @agentruntimecontrolprotocol/runtime
```

## Use

```ts
import { ARCPServer } from "@agentruntimecontrolprotocol/runtime";
import { serveArcp } from "@agentruntimecontrolprotocol/bun";

const arcp = new ARCPServer({
  /* … */
});

const handle = serveArcp({
  port: 3000,
  host: "0.0.0.0",
  path: "/arcp",
  allowedHosts: ["arcp.example.com"],
  onTransport: (transport, request) => arcp.accept(transport),
  fallback: (req) => new Response("hello", { status: 200 }),
});

console.log(`listening on ${handle.url}`);
// later:
await handle.close();
```

## API

### `serveArcp(options): ArcpServeHandle`

| Option                                                       | Default     | Notes                                     |
| ------------------------------------------------------------ | ----------- | ----------------------------------------- |
| `port?: number`                                              | system pick | Bind port. `0` lets Bun pick a free port. |
| `host?: string`                                              | `"0.0.0.0"` | Bind host.                                |
| `path?: string`                                              | `"/arcp"`   | URL path that should upgrade.             |
| `allowedHosts?: readonly string[]`                           | none        | DNS-rebind protection.                    |
| `onTransport: (transport, origin: Request) => void`          | —           | Pair with `server.accept`.                |
| `fallback?: (req: Request) => Response \| Promise<Response>` | 404         | Handler for non-ARCP paths.               |

### `ArcpServeHandle`

| Field                    | Notes                                                   |
| ------------------------ | ------------------------------------------------------- |
| `port: number`           | Actual bound port (after `port: 0`).                    |
| `url: string`            | Convenience URL string (e.g. `ws://0.0.0.0:3000/arcp`). |
| `close(): Promise<void>` | Stop the listener.                                      |

## `BunWebSocketTransport`

The transport implementation used internally. Exported in case you
want to wrap a Bun WebSocket from outside `serveArcp`:

```ts
import { BunWebSocketTransport } from "@agentruntimecontrolprotocol/bun";

// inside a Bun.serve websocket handler:
{
  websocket: {
    open(ws) {
      const transport = new BunWebSocketTransport(ws);
      arcp.accept(transport);
    },
    message(ws, msg) { /* dispatched by transport */ },
    close(ws) { /* … */ },
  },
}
```

## When to use

- Anything running on Bun.
- Hono apps under Bun (in preference to [`@agentruntimecontrolprotocol/hono`](./hono.md),
  which targets `@hono/node-server`).

## Source

[`packages/middleware/bun/src/`](../../packages/middleware/bun/src/).

## Runnable example

[`examples/bun/`](../../examples/bun/).
