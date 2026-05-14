# Vendor extensions (two-process)

Demonstrates the `x-vendor.*` extension namespace. The agent emits a
custom `x-vendor.acme.progress` job-event kind alongside the reserved kinds,
and requests a custom `x-vendor.acme.metrics` lease namespace.

The client demonstrates the two valid receiver behaviours:

- A _naïve_ receiver only understands the 8 reserved event kinds and
  MUST ignore everything else gracefully. The client tracks how many
  events the naïve path skipped.
- A _vendor-aware_ receiver recognises `x-vendor.acme.progress` and renders a
  live percent bar for each one.

Both run as separate handlers against the same envelope stream.

## Run

In one terminal:

```sh
pnpm tsx examples/vendor-extensions/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/vendor-extensions/client.ts
```

## What it demonstrates

- §8.2 a non-reserved event kind via `ctx.emitEvent("x-vendor.acme.progress", body)`.
- §15 / §9.2 the `x-vendor.*` namespace applies to both event kinds and
  lease capability namespaces. Anything outside that prefix is rejected
  by the runtime; anything inside it is opaque and tolerated.
- §8.2 receivers MUST ignore unknown kinds — both behaviours (skip vs.
  render) appear in the same client.

## Configuration

| Env var           | Default                    | Used by |
| ----------------- | -------------------------- | ------- |
| `ARCP_DEMO_PORT`  | `7884`                     | server  |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7884/arcp` | client  |
| `ARCP_DEMO_TOKEN` | `demo-token`               | both    |
