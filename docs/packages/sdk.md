# @arcp/sdk

Meta-package. Re-exports everything from
[`@arcp/core`](./core.md), [`@arcp/client`](./client.md), and
[`@arcp/runtime`](./runtime.md), and ships the `arcp` CLI binary.

## Install

```sh
pnpm add @arcp/sdk
```

## Use

```ts
import {
  ARCPClient,
  ARCPServer,
  pairMemoryTransports,
  StaticBearerVerifier,
  WebSocketTransport,
  startWebSocketServer,
} from "@arcp/sdk";
```

Anything in core/client/runtime is reachable through this entry point.
For tree-shakable browser bundles, prefer importing directly from
`@arcp/client` (avoids pulling in the runtime).

## CLI

`@arcp/sdk` ships an `arcp` binary. See [cli.md](../cli.md) for the
full command reference.

## When to use which package

- **`@arcp/sdk`** — apps that contain both client and runtime in the
  same process (in-process workers, integration tests, monoliths).
- **`@arcp/client`** + `@arcp/core`** — browser apps, lightweight
  agents-as-clients.
- **`@arcp/runtime`** + `@arcp/core`** — server processes that host
  agents but never act as ARCP clients themselves.

`@arcp/core` is always a transitive dep — you don't usually install
it explicitly.
