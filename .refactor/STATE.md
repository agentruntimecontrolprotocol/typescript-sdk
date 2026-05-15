# Refactor State

- Branch: `refactor/automation` (based on `326dd2b` on `main`)
- Phase: 1 (Investigation) — **complete**
- Current sub-phase: 2.1 (Tooling baseline) — **next up**
- Current package: workspace-wide
- Last completed sub-phase: Phase 1 (Investigation)
- Last commit on branch: (set by next commit)
- Gates passing (initial): G1 (typecheck), G2 (lint), G3 (test) — see
  `baseline.md`. Note these are baseline-only; once Section-11 ESLint
  rules are added in 2.1, G2/G7/G8/G9 will turn red until 2.5 closes
  them.
- Gates failing (post-2.1 expected): G6 (7 files >300 lines), G7,
  G8, G9 (counts unknown until rules enforce), G10 (TSDoc absent),
  G11 (`attw` not installed), G12 (`publint` not installed).
- Sessions consumed: 1
- Estimated remaining work:
  - Sub-phase 2.1 (Tooling baseline): ~1 session.
  - Sub-phase 2.2 (Surface audit): ~1 session.
  - Sub-phase 2.3 (Errors): ~1 session.
  - Sub-phase 2.4 (Async hygiene): ~1 session.
  - Sub-phase 2.5 (Complexity reduction): **~3–5 sessions** —
    `server.ts` (1912 lines) alone is a multi-session effort; six
    other files >300 lines.
  - Sub-phase 2.6 (Naming/style): ~0.5 session.
  - Sub-phase 2.7 (TSDoc): ~1–2 sessions (broad surface).
  - Sub-phase 2.8 (Build/publish): ~0.5 session.
  - Sub-phase 2.9 (Verification + final report): ~0.5 session.
  - **Total estimate: 9–12 sessions.**

## Notes for the next session

- Session 1 left the repo at the end of Phase 1. Sub-phase 2.1 is
  the natural next chunk and is small/contained.
- The user's pre-refactor WIP on `main` was stashed (see
  `wip-handling.md`). It overlaps with `packages/runtime/src/server.ts`
  which is the single largest violation. Coordinate with the user
  before sub-phase 2.5 touches `server.ts` — pop the stash *into*
  the refactor work or extract the WIP commits separately.
- The complexity inventory in `violations.md` for functions is a
  placeholder. Sub-phase 2.1 must enable the ESLint rules so 2.5 has
  precise targets.
