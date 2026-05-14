# progress example (v1.1)

Demonstrates ARCP v1.1's `progress` job event kind. The agent emits
`{ current, total, units, message }` periodically; the client
renders a simple text progress bar. The protocol does not act on
progress events — they're purely advisory.

## Run

In one terminal:

```sh
pnpm tsx examples/progress/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/progress/client.ts
```

On a TTY you'll see the bar update in place; piping to a file
prints one line per update.

## What it demonstrates

- §8.2.1 `progress` event kind and body shape.
- Runtime emits it as a `job.event` like any other reserved kind.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7892`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7892/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
