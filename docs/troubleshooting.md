# Troubleshooting

Common failure modes and how to fix them.

## `UNAUTHENTICATED` on connect

**Symptom:** `client.connect()` rejects with `UnauthenticatedError`,
the runtime's transport closes immediately.

**Causes:**

- Wrong `token` on `ARCPClientOptions`.
- The runtime's `BearerVerifier` rejects the token.
- Custom verifier throws — error message lives in
  `error.details.cause` if your verifier sets it.

**Fix:** verify the token round-trips through your verifier in
isolation. For `StaticBearerVerifier`, check the map key exactly
matches what the client sends.

## `RESUME_WINDOW_EXPIRED`

**Symptom:** `client.resume()` rejects.

**Causes:**

- Reconnected after `resume_window_sec` elapsed.
- The runtime restarted (default `EventLog` is in-memory).

**Fix:**

- Persist the event log if you need cross-restart resume — implement
  the `EventLog` interface against SQLite/Postgres/Redis.
- Increase `resumeWindowSeconds` if the workload is bursty and clients
  may take long to reconnect.

## `INVALID_REQUEST` on resume

**Symptom:** runtime rejects the resume.

**Causes:**

- `last_event_seq` is higher than the runtime's latest known seq for
  this session (client claimed to see events that don't exist).
- The session_id doesn't match the resume_token's bound session.

**Fix:** start a fresh session. Don't paper over the inconsistency.

## `PERMISSION_DENIED` from `tool_call`

**Symptom:** `tool_result.error.code === "PERMISSION_DENIED"` arrives
on the parent job.

**Cause:** the lease doesn't cover the target. The runtime
canonicalizes both the lease pattern and the target before matching,
so e.g. `https://API.example.com/` becomes
`https://api.example.com/` for both sides.

**Fix:**

- Widen the `lease` on `submit`. Remember the runtime can narrow but
  not widen.
- Check canonicalization — patterns like `https://*` only match a
  single segment; for "any host on this scheme," use `https://**`.

See [leases guide](./guides/leases.md#canonicalization-14).

## `LEASE_SUBSET_VIOLATION` on delegate

**Symptom:** Parent agent receives a `tool_result.error.code ===
"LEASE_SUBSET_VIOLATION"` shortly after emitting a `delegate` event.

**Cause:** the child's `lease_request` is broader than the parent's
effective lease.

**Fix:** widen the parent's `lease` on submit (the client controls
this) or narrow the child's request. Note that the parent's
**effective** lease (after the runtime narrowed it) is what counts —
the original request doesn't.

## Job stuck in `pending`

**Symptom:** `job.accepted` arrived but no events ever come; job
never reaches `running`.

**Cause:** the registered agent handler hasn't yielded — either it's
synchronous and blocking the runtime's event loop, or it's awaiting
something that never resolves.

**Fix:**

- Make sure the agent handler is `async`.
- Yield via `ctx.status("running")` early so you can confirm dispatch
  is wired up.
- Check for deadlocks: an agent that calls a tool that depends on the
  same agent.

## Stdio transport breaks unexpectedly

**Symptom:** parent process sees a frame parse error or the channel
closes.

**Cause:** the child wrote non-envelope bytes to `stdout` — common
culprits are `console.log` calls or unsilenced library logs.

**Fix:**

- Route logs to `stderr`: `console.error(...)`, `pino({ destination:
  process.stderr })`, etc.
- For libraries you can't reroute, set `silent: true` or run them
  inside a context that buffers `stdout`.

## Back-pressure stall

**Symptom:** agent emission methods (`ctx.log`, `ctx.toolCall`, etc.)
hang.

**Cause:** the runtime is back-pressure-throttling because the client
isn't acking events fast enough.

**Fix:**

- Enable `autoAck: true` on the client.
- Tune `backPressureThreshold` on the runtime if your client is
  intentionally slow.
- Investigate the client's `on("job.event")` handler — if it does
  blocking work, the event loop falls behind.

## Memory growth on long sessions

**Symptom:** RSS grows steadily on the runtime side.

**Causes:**

- Resume buffer is unbounded — by default it accepts up to
  `maxBufferedEvents = 10_000` / `maxBufferedBytes = 16 MiB` per
  session. Long-running sessions with many subscribers can hit this.
- Idempotency cache TTL is 24h by default; high-throughput tenants
  with many distinct keys accumulate entries.

**Fix:**

- Lower `caps.maxBufferedBytes` / `caps.maxBufferedEvents`.
- Lower `idempotencyTtlMs` if your retry window is shorter.
- Use a persistent `EventLog` so the buffer doesn't grow in process
  memory.

## `HEARTBEAT_LOST`

**Symptom:** session closes after a network hiccup, even though the
transport itself stayed open.

**Cause:** two consecutive `session.heartbeat` pings went un-ponged.

**Fix:**

- Increase `heartbeatIntervalSeconds` if your client occasionally
  blocks the event loop for >2× the interval.
- Disable heartbeat: drop it from `features` on both sides.
- Investigate why the event loop blocks — usually a CPU-bound handler
  that should be off-thread.

## `DUPLICATE_KEY`

**Symptom:** retry with same `idempotencyKey` returns this error.

**Cause:** the new submit's `input` (or `agent`, or `lease_request`)
differs from the cached job's. ARCP idempotency keys are a
content-fingerprint check, not just a deduplication.

**Fix:** either pass a fresh key for the new content, or restore
exact input parity.

## `AGENT_VERSION_NOT_AVAILABLE`

**Symptom:** `submit({ agent: "x@v3" })` rejects.

**Cause:** the runtime doesn't have `x@v3` registered.

**Fix:**

- Inspect `welcome.capabilities.agents` for the available versions.
- Submit without a `@version` to get the runtime's default.

## Events arrive but `handle.done` never resolves

**Symptom:** events stream fine, but `await handle.done` hangs.

**Cause:** the agent returned undefined and didn't emit a terminal
event explicitly when using `streamResult()` (v1.1).

**Fix:** when using `streamResult()`, call `stream.finalize()` — that's
what emits `job.result`. Returning from the handler after `finalize()`
is fine but optional.

## Lint / typecheck errors after upgrade

If you upgrade `@arcp/*` and hit type errors, check:

- `exactOptionalPropertyTypes` interactions — the SDK treats
  optional-and-undefined as distinct types.
- Branded ID assignments — passing a raw string where `JobId` is
  expected fails. Use `newJobId()` or cast via the brand helper.

## Still stuck?

- Check `examples/` for a working two-process version of the pattern
  you're trying to use.
- Re-read the relevant guide page; canonicalization, sequence
  numbers, and feature negotiation trip people up most often.
- Open an issue with a minimum repro — two files,
  `server.ts`/`client.ts`, both runnable with `pnpm tsx`.
