# @agentruntimecontrolprotocol/node

Attach the ARCP WebSocket upgrade to an existing Node `http.Server`
or `https.Server`. The lowest-level host integration — every other
Node-based middleware (`@agentruntimecontrolprotocol/express`, `@agentruntimecontrolprotocol/fastify`,
`@agentruntimecontrolprotocol/hono`) layers on top of this one.

## Install

```sh
pnpm add @agentruntimecontrolprotocol/node @agentruntimecontrolprotocol/runtime
```

## Use

```ts
import { createServer } from "node:http";
import { ARCPServer } from "@agentruntimecontrolprotocol/runtime";
import { attachArcpUpgrade } from "@agentruntimecontrolprotocol/node";

const httpServer = createServer((req, res) => {
  // your regular HTTP handler (REST, static, etc.)
  res.end("hello");
});

const arcp = new ARCPServer({
  /* … */
});

const handle = attachArcpUpgrade(httpServer, {
  path: "/arcp",
  allowedHosts: ["api.example.com"],
  onTransport: (transport, req) => arcp.accept(transport),
});

httpServer.listen(3000);

// later:
await handle.close();
```

## API

### `attachArcpUpgrade(server, options)`

```ts
function attachArcpUpgrade(
  server: HttpServer,
  options: AttachArcpUpgradeOptions,
): ArcpUpgradeHandle;
```

Wires an `"upgrade"` listener on the given server. Returns a handle
with `close()` to detach.

### `AttachArcpUpgradeOptions`

| Field                                   | Default   | Notes                                                                                                         |
| --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `path?: string`                         | `"/arcp"` | URL path that should upgrade. Other paths fall through.                                                       |
| `allowedHosts?: readonly string[]`      | none      | If set, rejects upgrades whose `Host` header isn't in the list (DNS-rebind protection).                       |
| `onTransport: (transport, req) => void` | —         | Receives a paired `Transport` and the original `IncomingMessage`. Typically calls `server.accept(transport)`. |

### `ArcpUpgradeHandle`

| Field                    | Notes                                                            |
| ------------------------ | ---------------------------------------------------------------- |
| `close(): Promise<void>` | Detach the upgrade listener; existing transports are unaffected. |

## DNS-rebind protection

Without `allowedHosts`, the upgrade accepts any `Host` header. For
public-facing servers, set it to the hosts you actually serve from:

```ts
attachArcpUpgrade(httpServer, {
  allowedHosts: ["arcp.example.com", "arcp.example.com:443"],
  onTransport: (t) => arcp.accept(t),
});
```

A mismatch returns `403 Forbidden` to the upgrading client.

## Multiple paths

To host multiple ARCP namespaces on one server, attach more than
once:

```ts
attachArcpUpgrade(httpServer, { path: "/arcp/v1", onTransport: forV1 });
attachArcpUpgrade(httpServer, { path: "/arcp/v2", onTransport: forV2 });
```

## Source

[`packages/middleware/node/src/`](../../packages/middleware/node/src/).
