# Handoff to Next Session

**Date written:** 2026-05-14 by Session 2.

## Where we are

Sub-phase 2.1 (Tooling baseline) is complete. The WIP runtime split
was recovered and integrated on `refactor/automation`. The strict
ESLint rules and publish tooling (`attw`, `publint`, `madge`) are
in place. Gates measurement is now precise — see `STATE.md` for the
current matrix.

## What to do first in the next session

1. Read `STATE.md` and confirm: "Current sub-phase: 2.2".
2. **Do not re-investigate.** `violations.md` lists every violation
   by sub-phase with checkboxes. Trust it.
3. Begin **Sub-phase 2.2 — Surface audit**.

## Specifically for sub-phase 2.2

The audit compares the current `.d.ts` of every package barrel to
`.refactor/api-snapshot/` (frozen in Phase 1).

1. Run `pnpm build` to regenerate `.d.ts` files.
2. For each package, diff `packages/<pkg>/dist/index.d.ts` (and
   subpath barrels) against the snapshot:
   ```
   diff -u .refactor/api-snapshot/core.d.ts packages/core/dist/index.d.ts
   ```
   (loop through all of them).
3. **Expected:** no diff. The WIP runtime split was already
   verified to keep typecheck green and was structured as an
   internal-only refactor; if `runtime/dist/index.d.ts` differs,
   investigate — it shouldn't.
4. If any diff is found, classify each entry:
   - (a) non-breaking (added optional field, expanded union,
     widened type) → leave as-is, note in commit message.
   - (b) breaking → append to `.refactor/breaking_changes.md` with
     proposed-shape/current-shape/why-it-broke; **do not change
     the public symbol**.
5. Commit (whether trivial or substantive):
   `refactor(api): surface audit; no breaking changes` (or
   `breaking changes deferred to breaking_changes.md`).
6. Run the Checkpoint Protocol (verify, commit, update state).

If 2.2 is empty, continue into Sub-phase 2.3 (Errors) in the same
session — that one is also relatively small (9 raise-sites to
convert + add `SdkError` union).

## Risks and gotchas

- **`pnpm lint`** will be red (79 ESLint errors). This is expected
  and tracked. CI marks `Lint (eslint)` as advisory until 2.5
  closes them. **Do not** "fix" them piecemeal during 2.2/2.3/2.4
  — sub-phase 2.5 owns them and does it systematically.
- **6 madge cycles** in `@arcp/runtime` are tracked under 2.5
  (`violations.md`). Don't address in 2.2.
- **Pre-commit hook** is now `lint:biome && typecheck && test`.
  Slow precommit lint (full ESLint) was moved to CI advisory.
  Don't loosen further.
- **`packages/runtime/src/server.ts`** is still the biggest file
  (1290 lines) and overlaps with future user iteration on the
  runtime. Coordinate before deep edits.
- **An automated user-side hook seems to be auto-committing.**
  Commit `c7bd82e` was created by such a hook with my staged
  changes but with a shorter message than I'd written. The
  content was correct. If this recurs, the message-quality side
  is the only concern; the workflow proceeds normally.

## What is mid-flight

Nothing. This session ended at a clean sub-phase boundary.
