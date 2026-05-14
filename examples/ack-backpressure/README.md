# ack-backpressure example (v1.1)

Demonstrates ARCP v1.1's flow-control: `session.ack` lets clients
acknowledge the highest `event_seq` they've processed; the runtime
tracks per-session lag (highest emitted - lastAcked) and surfaces a
`back_pressure` status when lag exceeds its threshold.

In this demo the client opts into `autoAck` but deliberately starves
it — long interval, huge delta threshold — so the server's
`backPressureThreshold: 200` is crossed quickly during a 2000-event
metric burst.

## Run

In one terminal:

```sh
pnpm tsx examples/ack-backpressure/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/ack-backpressure/client.ts
```

The client prints the back-pressure status event when the runtime
observes the lag.

## What it demonstrates

- §6.5 `session.ack` flow control and consumer-lag detection.
- §8.2 `status { phase: "back_pressure" }` runtime-emitted event.

## Configuration

| Env var | Default | Used by |
|---|---|---|
| `ARCP_DEMO_PORT`  | `7886` | server |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7886/arcp` | client |
| `ARCP_DEMO_TOKEN` | `demo-token` | both |
