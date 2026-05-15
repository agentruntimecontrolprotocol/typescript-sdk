# WIP Handling

Before bootstrap on 2026-05-14, the working tree on `main` was dirty
with the following:

- Modified: `packages/runtime/src/server.ts`
- Untracked: `packages/runtime/src/agent-registry.ts`
- Untracked: `packages/runtime/src/job-runner.ts`
- Untracked: `packages/runtime/src/stores.ts`

These were stashed (non-destructively) so the refactor could begin
from a clean tree.

**Stash entry:** `WIP: runtime work parked before refactor automation
(2026-05-14)` — recover with `git stash list` and
`git stash pop <ref>`.

**Branch base:** `refactor/automation` was created from clean `main`
at the commit prior to the stash (`326dd2b`).

**Resume guidance:** the stashed runtime work likely overlaps with
files that the complexity-reduction sub-phase will touch. Coordinate
with the user before popping the stash onto a refactored tree —
prefer cherry-picking specific changes over a blind pop.
