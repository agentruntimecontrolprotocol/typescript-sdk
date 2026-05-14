# list-jobs example (v1.1)

Demonstrates ARCP v1.1's `session.list_jobs` envelope: read-only
inventory of jobs accessible to the current session, with filter +
pagination. The default authorization scope is same-principal.

The demo submits three long-running tasks, lists them with
`limit: 2` (two pages), prints each summary entry, then cancels all
three for cleanup.

## Run

In one terminal:

```sh
pnpm tsx examples/list-jobs/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/list-jobs/client.ts
```

## What it demonstrates

- §6.6 `session.list_jobs` / `session.jobs` envelopes.
- Filtering on `status` and pagination via `next_cursor`.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7887`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7887/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
