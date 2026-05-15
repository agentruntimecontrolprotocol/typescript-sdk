# Judgment Calls

Append-only log of decisions made when the guide is silent or
ambiguous. Each entry: date, sub-phase, decision, one-line rationale.

---

## 2026-05-14 — Phase 1

- **WIP handling: stash, not commit.** Stashed dirty runtime work
  (server.ts modification + 3 untracked files) instead of committing
  it to `main` or branching from a dirty tree. Reason: stashes are
  reversible and don't pollute history; the user can recover the WIP
  with `git stash pop` or cherry-pick selectively after refactor.
- **Refactor branch base: clean `main`.** Branched
  `refactor/automation` from clean `main` (`326dd2b`) after the
  stash. Reason: the refactor needs a stable base to diff against; a
  dirty base would conflate refactor changes with WIP.
- **Snapshot subpath barrels too, not just `index.ts`.** Saved
  `.d.ts` for every export-map subpath
  (e.g. `@arcp/core/envelope`, `@arcp/sdk/client`), not just the
  package roots. Reason: the codebase deliberately uses subpath
  exports; the public surface contract includes them, so the
  Phase-1 snapshot must cover them for an honest later diff.
- **`biome` ignore for `.refactor/`.** Added
  `"!.refactor"` to `biome.json` `files.includes`. Reason: the
  refactor state directory contains `.d.ts` reference files (in
  `api-snapshot/`) that biome would lint as source. ESLint already
  ignores `**/*.d.ts` so no eslint change was needed.
- **Function-level violations deferred until sub-phase 2.1.** The
  Phase-1 inventory does not enumerate functions exceeding 40
  lines / complexity 10 / 3 params individually — heuristic awk
  scans were unreliable. Decision: enable the ESLint rules in
  sub-phase 2.1 and let lint output be the authoritative violation
  list for sub-phase 2.5.
