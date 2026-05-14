# agent-versions example (v1.1)

Demonstrates ARCP v1.1's agent-versioning grammar (`name@version`).
The runtime advertises a rich agent inventory with multiple
versions; the client submits one job per resolution path: bare name,
pinned version, and an unregistered version (error).

## Run

In one terminal:

```sh
pnpm tsx examples/agent-versions/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/agent-versions/client.ts
```

## What it demonstrates

- §7.5 agent-name grammar `name | name "@" version`.
- §7.5 default-version resolution for bare-name submits.
- §12 `AGENT_VERSION_NOT_AVAILABLE` for an unregistered version.
- §6.2 / §7.5 rich `capabilities.agents` inventory entries.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7889`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7889/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
