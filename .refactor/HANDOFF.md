# Handoff to Next Session

**Date written:** 2026-05-14 by Session 3.

## Where we are

Sub-phases 2.2 (Surface audit) and 2.3 (Errors) are complete. The
public API surface had zero drift from the Phase-1 snapshot; nine
raw `throw new Error(...)` sites were converted to typed
`ARCPError` subclasses; a `SdkError` discriminated union was
added to the `@arcp/core` barrel as a non-breaking addition.

Lint (biome), typecheck, and tests are all green.

## What to do first in the next session

1. Read `STATE.md` and confirm: "Current sub-phase: 2.4".
2. **Do not re-investigate.** `violations.md` lists every
   AbortSignal-plumbing target in sub-phase 2.4 with checkboxes.
3. Begin **Sub-phase 2.4 — Async hygiene**.

## Specifically for sub-phase 2.4

The bulk of 2.4 is **adding `signal?: AbortSignal` to options on
seven `ARCPClient` public methods**. All additive; no positional
arg changes. Per-method instructions:

| Method                         | Action                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `connect(transport, opts?)`    | Add `opts?: { signal?: AbortSignal }`. Plumb to `connectInternal`.      |
| `resume(transport, resume, opts?)` | Add `opts?: { signal?: AbortSignal }`. Plumb similarly.            |
| `send(env, opts?)`             | Add `opts?: { signal?: AbortSignal }`. Honor before `transport.send`.   |
| `ack(seq, opts?)`              | Add `opts?: { signal?: AbortSignal }`.                                  |
| `cancelJob(jobId, options)`    | Extend `options` with `signal?: AbortSignal`.                           |
| `listJobs(filter?, opts)`      | Extend `opts` with `signal?: AbortSignal`.                              |
| `subscribe(jobId, opts)`       | Extend `opts` with `signal?: AbortSignal`. Forward to `pending.register({ signal })`. |

`submit(opts)` already takes `signal` via `SubmitOptions`. Leave it
alone.

After each method, rebuild the `@arcp/client` package and verify
the `.d.ts` diff against `.refactor/api-snapshot/client.d.ts` is
additive only.

Also verify in 2.4:

- [ ] Re-run `eslint . | grep no-floating-promises` — must be zero.
- [ ] Re-run `eslint . | grep no-misused-promises` — must be zero.
- [ ] `grep -rn "Promise.all(" packages/*/src` — confirm any
      `Promise.all` over user-supplied input is bounded (e.g.
      `p-limit`). The likely candidate is `runtime/job-runner.ts`
      (event fan-out to subscribers).
- [ ] `grep -rn "constructor.*async" packages/*/src` — must be empty.

Commit per logical change. Final commit message convention:
`refactor(async): cancellation, no floating promises`.

## Risks and gotchas

- The `.d.ts` snapshot will record an additive drift after 2.4
  (every client method gains an `opts?: { signal? }` parameter).
  This is non-breaking; do **not** add to `breaking_changes.md`.
  Note the additive diff in the commit message instead.
- The 6 madge cycles in `@arcp/runtime` remain. Don't touch them
  in 2.4 — they're 2.5 work.
- Pre-commit hook is `lint:biome && typecheck && test`. Strict
  ESLint will continue to be advisory in CI until 2.5 wraps.
- `auto-commit` from a user-side hook may still fire — content has
  been correct each time; cosmetic-only concern.

## What is mid-flight

Nothing. This session ended at the 2.3 sub-phase boundary.
