# Express example (`@arcp/express`)

Run an ARCP runtime side-by-side with normal Express HTTP routes on a
single port. `@arcp/express` provides:

- `createArcpExpressApp({ allowedHosts })` — an Express instance with
  `x-powered-by` disabled and a Host-header DNS-rebind guard on the
  HTTP side.
- `attachArcpToExpress(httpServer, { path, allowedHosts, onTransport })`
  — registers the WS upgrade handler on the underlying `http.Server`
  with the same Host check.

The Express request pipeline never sees the ARCP traffic; the upgrade
event fires on the raw `http.Server` before Express's router runs.

## Run

In one terminal:

```sh
pnpm tsx examples/express/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/express/client.ts
```

The client makes `GET /health` first, then opens a WebSocket to
`/arcp`, submits an `echo` job, and prints the result. Stop the server
with `Ctrl+C`.

## What it demonstrates

- One Node HTTP server, two protocols on one port (HTTP + ARCP WS).
- DNS-rebinding protection via `allowedHosts` on both the HTTP routes
  and the WebSocket upgrade.
- The same `ARCPServer`/agent-registration code as every other
  example — the middleware is purely a mount point.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7896`                     | both    |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7896/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
