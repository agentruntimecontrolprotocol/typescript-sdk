# Refactor State

- Branch: `refactor/automation` (based on `326dd2b` on `main`)
- Phase: 1 (Investigation) — **complete**
- Current sub-phase: 2.3 (Errors) — **complete (2026-05-14)**
- Next sub-phase: 2.4 (Async hygiene)
- Current package: workspace-wide
- Last completed sub-phase: 2.3
- Last commit on branch: `ed10415` (typed errors + SdkError union)
- Gates status (measured 2026-05-14 after 2.3):
  - G1 typecheck: 🟢 PASS
  - G2 lint: 🔴 RED — biome clean, ESLint has 79 errors (advisory)
  - G3 tests: 🟢 PASS
  - G4 cycles: 🔴 RED — 6 cycles in @arcp/runtime
  - G5 .d.ts diff: 🟡 ADDITIVE — `SdkError` type alias added in 2.3
    (non-breaking; recorded in commit message, not in
    breaking_changes.md)
  - G6 files ≤300 lines: 🔴 RED — 5 files over
  - G7 functions ≤40 lines: 🔴 RED — 28 violations
  - G8 complexity ≤10: 🔴 RED — 20 violations
  - G9 params ≤3: 🔴 RED — 4 violations
  - G10 TSDoc on every public export: 🔴 RED — not yet enforced
  - G11 `attw`: 🟢 PASS
  - G12 `publint`: 🟢 PASS
- Sessions consumed: 3 (Session 3 = sub-phases 2.2 + 2.3)
- Estimated remaining work:
  - ~~Sub-phase 2.1 (Tooling baseline)~~ — done Session 2.
  - ~~Sub-phase 2.2 (Surface audit)~~ — done Session 3 (no drift).
  - ~~Sub-phase 2.3 (Errors)~~ — done Session 3.
  - Sub-phase 2.4 (Async hygiene): ~1 session — bigger than first
    estimated; 7 client methods need `signal` plumbed through
    options bag (additive, non-breaking).
  - Sub-phase 2.5 (Complexity reduction): **~2–4 sessions** — 79
    ESLint errors across 12 files + 6 runtime import cycles to
    untangle.
  - Sub-phase 2.6 (Naming/style): ~0.5 session.
  - Sub-phase 2.7 (TSDoc): ~1–2 sessions (broad surface).
  - Sub-phase 2.8 (Build/publish): ~0.5 session — `attw` and
    `publint` already clean.
  - Sub-phase 2.9 (Verification + final report): ~0.5 session.
  - **Total estimate: 6–9 sessions from here.**

## Notes for the next session

- Sub-phase 2.4 is the next chunk. See `violations.md` for the
  precise list — 7 client methods need an optional `signal` added
  via their options bag. All non-breaking additions; runtime
  side already flows signal via `pending.register`. Add the param,
  pass it through to `pending.register({ signal })` (or the
  equivalent), and verify `.d.ts` diff is additive only.
- The 6 runtime cycles surfaced by `madge` are the result of the
  WIP recovery and *should* be addressed in 2.5 alongside the
  server/job-runner split, not earlier — fixing them now would
  duplicate work.
- After 2.4 wraps, sub-phase 2.5 is the largest remaining chunk
  and is what the user's WIP started. Session estimate for 2.5:
  2–4 sessions, file by file from `violations.md`.
