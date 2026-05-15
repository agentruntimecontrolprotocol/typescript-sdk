# Guide Violations Inventory (Phase 1)

Captured against `TYPESCRIPT_SDK_GUIDE.md` on 2026-05-14. Each item
has a checkbox so future sessions can mark it resolved as work
proceeds. Counts are approximate where based on heuristics; precise
counts will come from guide-conformant ESLint rules added in
**sub-phase 2.1**.

Headline: this codebase is in unusually good shape on the small
mechanical violations. The real work is **complexity reduction**
(file/function size) and the missing tooling/docs around it.

---

## Sub-phase 2.1 — Tooling baseline

- [ ] Add `useUnknownInCatchVariables` to `tsconfig.base.json`
      (only Section-0 flag missing).
- [ ] Add `max-lines: 300` to ESLint config.
- [ ] Add `max-lines-per-function: 40` to ESLint config.
- [ ] Add `max-params: 3` to ESLint config.
- [ ] Add `max-depth: 3` to ESLint config.
- [ ] Add `complexity: 10` to ESLint config.
- [ ] Add `prefer-readonly: error` (currently `warn`) to ESLint
      config (guide section 11).
- [ ] Add `import/no-cycle: error` to ESLint config (already there;
      verify configured per-package).
- [ ] Install `@arethetypeswrong/cli`, `publint`, `madge`,
      `eslint-plugin-tsdoc` as devDependencies.
- [ ] Add CI steps: `attw --pack`, `publint`, `madge --circular`
      per published package.
- [ ] Add `tsd` or `expectTypeOf` setup for type tests on generics.

---

## Sub-phase 2.2 — Surface audit (non-breaking fixes)

- [ ] Re-emit `.d.ts` and diff against `.refactor/api-snapshot/`;
      list every drift and classify (a) safe-fix vs (b) breaking.
- [ ] Confirm no public symbol uses `Record<string, unknown>` where
      a defined shape is reasonable.
- [ ] Confirm every public function has explicit return type (rule
      already enforced by `explicit-module-boundary-types`; spot-check).
- [ ] Mark internal-only helpers with `@internal` TSDoc tag and
      configure API extractor to strip them (deferred to 2.7).

---

## Sub-phase 2.3 — Errors

`@arcp/core` already has a rich typed error hierarchy
(`packages/core/src/errors.ts`, 306 lines, 17 exported error
classes). The work is to ensure every raise site uses one:

- [ ] Replace `throw new Error(...)` with a typed subclass at all
      sites listed below (9 occurrences):
  - [ ] `packages/core/src/messages/execution.ts:91`
  - [ ] `packages/core/src/messages/execution.ts:98`
  - [ ] `packages/core/src/messages/execution.ts:101`
  - [ ] `packages/core/src/messages/execution.ts:133`
  - [ ] `packages/core/src/messages/execution.ts:138`
  - [ ] `packages/core/src/messages/execution.ts:142`
  - [ ] `packages/core/src/messages/execution.ts:411` (exhaustiveness
        guard — consider `InternalError` or a dedicated
        `UnreachableError`)
  - [ ] `packages/core/src/transport/websocket.ts:191`
  - [ ] `packages/core/src/state/pending.ts:25`
- [ ] Add `SdkError` discriminated union type alias exported from
      `@arcp/core/errors`.
- [ ] Audit every catch block for swallowed `cause` (manual review
      after 2.5 splits files).

---

## Sub-phase 2.4 — Async hygiene

- [ ] Verify every public async I/O function accepts an optional
      `AbortSignal`. Current signal usage points:
      `packages/client/src/types.ts:127`,
      `packages/runtime/src/types.ts:125`,
      `packages/core/src/util/abort.ts`,
      `packages/core/src/state/pending.ts:22`. Survey other public
      async functions for missing signal plumbing.
- [ ] `@typescript-eslint/no-floating-promises` is already enabled
      and clean. Re-verify after each refactor.
- [ ] No `async` constructors found in initial scan; re-verify after
      sub-phase 2.5 splits.

---

## Sub-phase 2.5 — Complexity reduction (files >300 lines)

Sorted largest first. Each entry is its own checkpoint.

- [ ] `packages/runtime/src/server.ts` — **1912 lines**. Likely the
      largest single split required. Coordinate with stashed WIP
      (see `wip-handling.md`); the user has untracked
      `agent-registry.ts`, `job-runner.ts`, `stores.ts` ready to
      receive extracted concerns.
- [ ] `packages/client/src/client.ts` — **822 lines**.
- [ ] `packages/core/src/messages/execution.ts` — **593 lines**.
- [ ] `packages/runtime/src/job.ts` — **589 lines**.
- [ ] `packages/runtime/src/lease.ts` — **430 lines**.
- [ ] `packages/core/src/errors.ts` — **306 lines** (just over;
      consider splitting protocol vs transport vs runtime errors).
- [ ] `packages/core/src/store/eventlog.ts` — **303 lines** (just
      over; small split).

### Files in the warning band (150–300 lines, monitor)

These are not violations but sit close to the cap. Touch only if
sub-phase 2.5 work brings them across the line.

- `packages/core/src/messages/session.ts` — 264
- `packages/runtime/src/types.ts` — 255
- `packages/middleware/otel/src/index.ts` — 222
- `packages/core/src/transport/websocket.ts` — 208
- `packages/core/src/envelope.ts` — 194
- `packages/core/src/util/json-schema.ts` — 172
- `packages/sdk/src/cli.ts` — 154
- `packages/core/src/state/session.ts` — 150

### Function-level complexity

- [ ] Re-measure with ESLint `max-lines-per-function`,
      `max-params`, `max-depth`, `complexity` after sub-phase 2.1
      enables them. Current heuristic scan was insufficient.
- [ ] Address every violation surfaced.

---

## Sub-phase 2.6 — Naming and style

- [x] All source files already kebab-case.
- [ ] Audit type/interface names for `I` / `T` prefixes (none found
      in spot check; verify systematically).
- [ ] Audit public symbol names for abbreviations (`cfg`, `req`,
      `res`, `ctx`, `opts`) — keep only where idiomatic
      (`AbortSignal`, `URL`).
- [ ] Apply Section-12 style cheatsheet via `biome` autofix where
      possible.

---

## Sub-phase 2.7 — Documentation (TSDoc)

- [ ] Audit every public export across all 10 package barrels for a
      TSDoc block (one-line summary + `@param`/`@returns`/`@throws`/
      `@example`/`@see` as relevant).
- [ ] Mark every internal helper with `@internal`.
- [ ] Add `eslint-plugin-tsdoc` and configure to enforce.

---

## Sub-phase 2.8 — Build, exports, publish

Already largely conformant — see `baseline.md`. Remaining:

- [ ] Confirm `@arcp/sdk` subpath exports all resolve cleanly under
      `attw --pack`.
- [ ] Add `publint` to CI per published package; fix any warnings.
- [ ] Add `madge --circular` to CI per package; fix any cycles
      introduced during 2.5 refactors.
- [ ] Confirm sourcemaps and declaration maps are emitted (spot check
      after a clean build).

---

## Sub-phase 2.9 — Final verification

- [ ] `.d.ts` diff vs `.refactor/api-snapshot/` empty (or every diff
      entry approved in `breaking_changes.md`).
- [ ] All 12 gates green per Phase 3 of `REFACTOR_PROMPT.md`.

---

## Items already conformant (no work required)

These are recorded for the final report's benefit:

- `any` usage in src: **0**.
- `@ts-ignore` usage: **0** (no `@ts-expect-error` either).
- `enum` / `namespace` usage: **0**.
- `default` exports: **0**.
- `console.*` in library code (excluding CLI): **0** (sole hit is a
  doc-comment example).
- File naming: 100% kebab-case.
- Circular deps: **0** per `madge`.
- `package.json` shape (type=module, sideEffects=false, exports map
  with conditions, provenance, engines): **conformant on all 10
  packages.**
- `tsconfig.base.json` strict flags from guide Section 0: **all
  present except `useUnknownInCatchVariables`**.
- Typecheck/lint/test baseline: **all green** (see `baseline.md`).
