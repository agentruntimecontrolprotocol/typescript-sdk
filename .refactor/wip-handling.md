# WIP Handling

Before bootstrap on 2026-05-14, the working tree on `main` was dirty
with the following:

- Modified: `packages/runtime/src/server.ts`
- Untracked: `packages/runtime/src/agent-registry.ts`
- Untracked: `packages/runtime/src/job-runner.ts`
- Untracked: `packages/runtime/src/stores.ts`

These were stashed (non-destructively) so the refactor could begin
from a clean tree.

**Status (Session 2):** the stash has been recovered onto
`refactor/automation` as commit `8227bda`. The user's WIP turned out
to be exactly the start of sub-phase 2.5 for `server.ts`: a partial
decomposition into `agent-registry.ts`, `job-runner.ts`, and
`stores.ts`, shrinking `server.ts` from 1912 → 1290 lines. Two
unused leftover constants in `server.ts` were removed as trivial
cleanup. Typecheck, lint, and the test suite all pass on the
recovered state. **The stash entry has been dropped.**

**Branch base:** `refactor/automation` was created from clean `main`
at `326dd2b`. The WIP recovery commit (`8227bda`) sits on top of the
Phase 1 init commits.

**Implication for sub-phase 2.5:** `server.ts` is still the largest
remaining file (1290 lines), but the heavy initial extraction is
done. Future 2.5 work on `server.ts` will continue from this
post-WIP state.
