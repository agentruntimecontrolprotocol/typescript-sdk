# result-chunk example (v1.1)

Demonstrates ARCP v1.1's chunked-result streaming. The agent calls
`ctx.streamResult()` to obtain a `ResultStream`, writes ~30 text
chunks, and `finalize()`s — which emits the terminating
`job.result` with `result_id` and `result_size`. The client's
`handle.collectChunks()` reassembles the payload.

## Run

In one terminal:

```sh
pnpm tsx examples/result-chunk/server.ts
```

In a second terminal:

```sh
pnpm tsx examples/result-chunk/client.ts
```

## What it demonstrates

- §8.4 `result_chunk` event kind and `more: false` terminator.
- §8.4 `job.result` carrying `result_id` + `result_size` instead of inline `result`.
- Client helper `JobHandle.collectChunks()` reassembles into a string/Buffer.

## Configuration

| Env var | Default | Used by |
|---|---|---|
| `ARCP_DEMO_PORT`  | `7893` | server |
| `ARCP_DEMO_URL`   | `ws://127.0.0.1:7893/arcp` | client |
| `ARCP_DEMO_TOKEN` | `demo-token` | both |
