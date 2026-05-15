# Handoff to Next Session

**Date written:** 2026-05-14 by Session 1.

## Where we are

Phase 1 (Investigation) is complete. Repo is on branch
`refactor/automation`, baseline is green
(typecheck/lint/test all pass), and the public-API contract is
snapshotted under `.refactor/api-snapshot/`.

## What to do first in the next session

1. Read `STATE.md` and confirm: "Current sub-phase: 2.1".
2. **Do not re-investigate.** `violations.md` and `baseline.md`
   are the authoritative inventories. Trust them.
3. Begin **Sub-phase 2.1 — Tooling baseline**. This sub-phase is
   small and self-contained: edit `tsconfig.base.json`, edit
   `eslint.config.js`, install missing dev tools, add CI steps,
   commit, checkpoint.

## Specifically for sub-phase 2.1

- Add to `tsconfig.base.json` `compilerOptions`:
  `"useUnknownInCatchVariables": true`.
- Add to `eslint.config.js` (workspace-level rule overrides):
  - `"max-lines": ["error", { "max": 300, "skipBlankLines": true, "skipComments": true }]`
  - `"max-lines-per-function": ["error", { "max": 40, "skipBlankLines": true }]`
  - `"max-params": ["error", 3]`
  - `"max-depth": ["error", 3]`
  - `"complexity": ["error", 10]`
  - Bump `@typescript-eslint/prefer-readonly` from `warn` to `error`.
- Install dev deps: `pnpm add -D -w @arethetypeswrong/cli publint madge eslint-plugin-tsdoc`.
- Add scripts to root `package.json`:
  - `"check:attw": "pnpm -r --filter './packages/**' exec attw --pack ."`
  - `"check:publint": "pnpm -r --filter './packages/**' exec publint"`
  - `"check:cycles": "madge --circular --extensions ts packages"`
- Update `.github/workflows/*` (or whatever CI is in place) to run
  the new checks on push/PR.
- **Expect lint to go red after enabling the new rules.** Do not
  attempt to fix all the new violations in sub-phase 2.1 — that is
  sub-phase 2.5. The 2.1 commit can leave G2/G6/G7/G8/G9 red as
  long as the *tooling* itself is in place and STATE.md records the
  expected red gates.
- Checkpoint: commit, update STATE.md to mark 2.1 complete and 2.2
  next, rewrite this HANDOFF.md, then either continue to 2.2 or end
  the session.

## Risks and gotchas

- **`packages/runtime/src/server.ts` (1912 lines)** is the heaviest
  single split required and it overlaps with the user's stashed
  WIP. Before sub-phase 2.5 touches it, **stop and prompt the user**
  to either pop the stash (so the WIP is preserved) or confirm it
  can be reorganized as part of the split. See `wip-handling.md`.
- The `.refactor/` directory must stay committed on the branch — it
  is the cross-session contract. Do not add it to `.gitignore`.
- `biome` 2.x prefers `"!folder"` over `"!folder/**"` — already
  applied in `biome.json`.

## What is mid-flight

Nothing. This session ended at a clean phase boundary.
