# Stdio (parent spawns child)

Demonstrates the §4.2 / §22 stdio transport. Unlike the other examples,
there is no TCP/WebSocket server: the parent process spawns the runtime
as a child subprocess, and the two communicate over the child's
stdin/stdout using newline-delimited JSON envelopes (one envelope per
line).

This is the same wire format the spec mandates for stdio deployments
(useful for tools like editor plugins or sandboxed runtimes where you
want the lifetime of the runtime tied to the client process).

## Run

A single command — the client spawns its own runtime:

```sh
pnpm tsx examples/stdio/client.ts
```

## How it works

- `client.ts` (parent) spawns `server.ts` as a child via
  `pnpm tsx <server.ts>` with `stdio: ["pipe", "pipe", "inherit"]`.
  The child's stdout becomes the runtime's outbound frames; the child's
  stderr is piped to the parent's terminal for diagnostic visibility.
- `server.ts` (child) constructs `StdioTransport.fromProcess()` —
  binding the transport to its own `process.stdin` / `process.stdout`
  — and `server.accept`s it.
- The client builds `StdioTransport.fromChild(child)` and runs the
  normal handshake / submit / await flow on top.

Logs from the server go to **stderr** because stdout is the wire.

## What it demonstrates

- §4.2 / §22 stdio as an MTI transport equivalent to WebSocket.
- Each ARCP envelope is a single line of JSON terminated by `\n`.
- The same `ARCPServer` and `ARCPClient` code works unchanged across
  transports — only the `Transport` instance differs.

## Configuration

| Env var | Default | Used by |
|---|---|---|
| `ARCP_DEMO_TOKEN`| `demo-token` | both |
