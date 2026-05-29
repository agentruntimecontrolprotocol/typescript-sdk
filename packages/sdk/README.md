# @agentruntimecontrolprotocol/sdk

TypeScript SDK meta-package for the Agent Runtime Control Protocol (ARCP).

Install this package when you want the full TypeScript reference SDK in one dependency:

- `@agentruntimecontrolprotocol/core` for shared protocol primitives, messages, transports, auth, state, and stores
- `@agentruntimecontrolprotocol/client` for submitting, observing, resuming, and cancelling jobs
- `@agentruntimecontrolprotocol/runtime` for hosting ARCP-compatible agent runtimes
- the `arcp` CLI

```sh
npm install @agentruntimecontrolprotocol/sdk
```

Requires Node.js 22 or later. The package is ESM-only.

## Quick start

```ts
import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const client = new ARCPClient({
  client: { name: "quickstart", version: "1.0.0" },
  authScheme: "bearer",
  token: process.env["ARCP_TOKEN"],
});

const transport = await WebSocketTransport.connect("wss://runtime.example.com/arcp");
await client.connect(transport);

const handle = await client.submit({
  agent: "data-analyzer",
  input: { dataset: "s3://example/sales.csv" },
  lease: { "net.fetch": ["s3://example/**"] },
});

const result = await handle.done;
console.log("final:", result.final_status, result.result);

await client.close();
```

## Package layout

The meta-package re-exports the public APIs from the core packages:

```ts
export * from "@agentruntimecontrolprotocol/core";
export * from "@agentruntimecontrolprotocol/client";
export * from "@agentruntimecontrolprotocol/runtime";
```

It also exposes focused subpath exports:

```ts
import { ARCPClient } from "@agentruntimecontrolprotocol/sdk/client";
import { ARCPServer } from "@agentruntimecontrolprotocol/sdk/runtime";
import { WebSocketTransport } from "@agentruntimecontrolprotocol/sdk/transport";
```

## Links

- Specification: https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md
- TypeScript SDK docs: https://github.com/agentruntimecontrolprotocol/typescript-sdk#readme
- Issues: https://github.com/agentruntimecontrolprotocol/typescript-sdk/issues
