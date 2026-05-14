# Heartbeat example (v1.1)

Demonstrates ARCP v1.1's `heartbeat` feature: the runtime emits
`session.ping` envelopes on a fixed cadence and the client replies
with `session.pong`. The runtime declares its cadence in
`session.welcome.payload.heartbeat_interval_sec`.

This server uses a 5-second interval (vs. the 30 s default) so the
demo finishes in a handful of seconds.

## Run

In one terminal:

```sh
pnpm tsx examples/heartbeat/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/heartbeat/client.ts
```

The client connects, prints `heartbeat_interval_sec=5`, submits one
echo job to prove the round-trip, then idles for ~12 s and prints the
ping count. Two pings are expected.

## What it demonstrates

- §6.4 `session.ping` / `session.pong` envelopes.
- §6.2 `heartbeat_interval_sec` advertisement on `session.welcome`.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7885`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7885/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
