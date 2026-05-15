# Refactor State

- Branch: `refactor/automation` (based on `326dd2b` on `main`)
- Phase: 1 (Investigation) — **complete**
- Current sub-phase: 2.1 (Tooling baseline) — **complete (2026-05-14)**
- Next sub-phase: 2.2 (Surface audit)
- Current package: workspace-wide
- Last completed sub-phase: 2.1
- Last commit on branch: `c7bd82e` (CI workflow update for 2.1)
- Gates status (measured 2026-05-14 after 2.1):
  - G1 typecheck: 🟢 PASS
  - G2 lint: 🔴 RED — biome clean, ESLint has 79 errors (advisory)
  - G3 tests: 🟢 PASS
  - G4 cycles: 🔴 RED — 6 cycles in @arcp/runtime
  - G5 .d.ts diff: 🟢 PASS (no public-API drift yet)
  - G6 files ≤300 lines: 🔴 RED — 5 files over
  - G7 functions ≤40 lines: 🔴 RED — 28 violations
  - G8 complexity ≤10: 🔴 RED — 20 violations
  - G9 params ≤3: 🔴 RED — 4 violations
  - G10 TSDoc on every public export: 🔴 RED — not yet enforced
  - G11 `attw`: 🟢 PASS
  - G12 `publint`: 🟢 PASS
- Sessions consumed: 2 (Session 2 = WIP recovery + sub-phase 2.1)
- Estimated remaining work:
  - ~~Sub-phase 2.1 (Tooling baseline)~~ — done in Session 2.
  - Sub-phase 2.2 (Surface audit): ~1 session.
  - Sub-phase 2.3 (Errors): ~1 session (9 `throw new Error(...)`
    sites + add `SdkError` union).
  - Sub-phase 2.4 (Async hygiene): ~1 session.
  - Sub-phase 2.5 (Complexity reduction): **~2–4 sessions** — 79
    ESLint errors across 12 files + 6 runtime import cycles to
    untangle.
  - Sub-phase 2.6 (Naming/style): ~0.5 session.
  - Sub-phase 2.7 (TSDoc): ~1–2 sessions (broad surface).
  - Sub-phase 2.8 (Build/publish): ~0.5 session — `attw` and
    `publint` already clean.
  - Sub-phase 2.9 (Verification + final report): ~0.5 session.
  - **Total estimate: 7–10 sessions from here.**

## Notes for the next session

- Sub-phase 2.2 (Surface audit) is the next chunk and is small —
  the `.refactor/api-snapshot/` baseline is already captured and
  the codebase has zero `any` / zero default exports / explicit
  module boundary types are enforced, so most safe-fix work is
  expected to be empty. Run `pnpm build` and diff the new `.d.ts`
  against `.refactor/api-snapshot/`; if empty, commit a no-op
  audit note and move on to 2.3.
- The 6 runtime cycles surfaced by `madge` are the result of the
  WIP recovery and *should* be addressed in 2.5 alongside the
  server/job-runner split, not earlier — fixing them now would
  duplicate work.
