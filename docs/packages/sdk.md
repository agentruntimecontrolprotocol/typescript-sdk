# @agentruntimecontrolprotocol/sdk

Meta-package. Re-exports everything from
[`@agentruntimecontrolprotocol/core`](./core.md), [`@agentruntimecontrolprotocol/client`](./client.md), and
[`@agentruntimecontrolprotocol/runtime`](./runtime.md), and ships the `arcp` CLI binary.

## Install

```sh
pnpm add @agentruntimecontrolprotocol/sdk
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
} from "@agentruntimecontrolprotocol/sdk";
```

Anything in core/client/runtime is reachable through this entry
point. The package also exposes subpath entries for selective imports
(declared in its `package.json` exports): `@agentruntimecontrolprotocol/sdk/client`,
`@agentruntimecontrolprotocol/sdk/runtime`, `@agentruntimecontrolprotocol/sdk/transport`,
`@agentruntimecontrolprotocol/sdk/messages`, and `@agentruntimecontrolprotocol/sdk/errors`.

For tree-shakable browser bundles, prefer importing directly from
`@agentruntimecontrolprotocol/client` (avoids pulling in the runtime).

## CLI

`@agentruntimecontrolprotocol/sdk` ships an `arcp` binary. See [cli.md](../cli.md) for the
full command reference.

## When to use which package

- **`@agentruntimecontrolprotocol/sdk`** — apps that contain both client and runtime in the
  same process (in-process workers, integration tests, monoliths).
- **`@agentruntimecontrolprotocol/client`** + `@agentruntimecontrolprotocol/core`\*\* — browser apps, lightweight
  agents-as-clients.
- **`@agentruntimecontrolprotocol/runtime`** + `@agentruntimecontrolprotocol/core`\*\* — server processes that host
  agents but never act as ARCP clients themselves.

`@agentruntimecontrolprotocol/core` is always a transitive dep — you don't usually install
it explicitly.
