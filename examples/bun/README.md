# Bun example (`@agentruntimecontrolprotocol/bun`)

Run an ARCP runtime under Bun via `serveArcp({...})`. `@agentruntimecontrolprotocol/bun` uses
`Bun.serve({ websocket })` directly — no `ws` dependency — and is the
only listener helper in the repo that runs in a non-Node environment.

The client side is unchanged: it's a normal `@agentruntimecontrolprotocol/sdk` `ARCPClient`
talking over WebSocket. The wire protocol is runtime-agnostic, so the
client can be Node or Bun and the server still works.

## Run

This example splits the run command between the two sides because the
server requires Bun.

In one terminal (server — Bun required):

```sh
bun run examples/bun/server.ts
```

In a second terminal (client — Node is fine, Bun is fine):

```sh
pnpm tsx examples/bun/client.ts
# or
bun run examples/bun/client.ts
```

The client submits an `echo` job whose `result.runtime` reads `"bun"`,
demonstrating that the server is in fact running under Bun. Stop the
server with `Ctrl+C`.

## What it demonstrates

- `serveArcp({...})` — the Bun-native entrypoint.
- One process binds the ARCP path (`/arcp`); the example uses Bun's
  default `fallback` for non-ARCP requests (HTTP 404).
- DNS-rebinding protection via `allowedHosts`.
- Runtime portability: a Node client interoperates with a Bun runtime
  over the same JSON-over-WebSocket protocol.

## Known limitation

`@agentruntimecontrolprotocol/runtime`'s default event log uses `better-sqlite3`, a native
Node module that does not yet load under Bun (see
[oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290)). The
`@agentruntimecontrolprotocol/bun` listener itself is Bun-native; the gap is one level up, in
the runtime's storage. Once `better-sqlite3` ships Bun support — or
`ARCPServer` gains a `bun:sqlite` adapter — this example will run
end-to-end. The wire surface, the listener, and the `serveArcp` API
are all exercised by `@agentruntimecontrolprotocol/bun`'s own unit tests in the meantime.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7898`                     | both    |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7898/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
