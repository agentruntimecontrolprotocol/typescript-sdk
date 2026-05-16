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

## Sub-phase 2.1 — Tooling baseline — **complete (2026-05-14)**

- [x] Add `useUnknownInCatchVariables` to `tsconfig.base.json`
      (only Section-0 flag missing).
- [x] Add `max-lines: 300` to ESLint config.
- [x] Add `max-lines-per-function: 40` to ESLint config.
- [x] Add `max-params: 3` to ESLint config.
- [x] Add `max-depth: 3` to ESLint config.
- [x] Add `complexity: 10` to ESLint config.
- [x] Add `prefer-readonly: error` (was `warn`) to ESLint config.
- [x] `import/no-cycle: error` confirmed in workspace ESLint config.
- [x] Install `@arethetypeswrong/cli`, `publint`, `madge`,
      `eslint-plugin-tsdoc` as devDependencies.
- [x] CI steps added: `check:cycles` (advisory), `check:attw`
      (required), `check:publint` (required). `lint:eslint` is now
      advisory until sub-phase 2.5 wraps; `lint:biome` is required.
- [ ] Add `tsd` or `expectTypeOf` setup for type tests on generics.
      *Deferred to sub-phase 2.7 (Documentation) — generics-heavy
      public surface is small and can be covered there.*

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

## Sub-phase 2.3 — Errors — **complete (2026-05-14)**

`@arcp/core` already has a rich typed error hierarchy
(`packages/core/src/errors.ts`, 14 exported subclasses pinned to
canonical wire codes).

- [x] Replace `throw new Error(...)` with a typed subclass at all
      9 sites:
  - [x] `core/messages/execution.ts:91,98,101` (agent name parser)
        → `InvalidRequestError`
  - [x] `core/messages/execution.ts:133,138,142` (cost.budget
        parser) → `InvalidRequestError`
  - [x] `core/messages/execution.ts:411` (exhaustiveness guard)
        → `InternalError`
  - [x] `core/transport/websocket.ts:191` (WS address unavailable)
        → `InternalError`
  - [x] `core/state/pending.ts:25` (correlation_id reuse)
        → `InternalError`
- [x] Add `SdkError` discriminated union type alias exported from
      `@arcp/core` (additive, non-breaking; .d.ts diff confirmed
      additive only).
- [ ] Audit every catch block for swallowed `cause`. **Deferred to
      after sub-phase 2.5 splits files** — auditing while files are
      mid-refactor wastes effort.

---

## Sub-phase 2.4 — Async hygiene

Survey done in Session 3. The public client surface needs real
signal plumbing — this is more than verification. Scope:

- [ ] **Add `signal?: AbortSignal` to options on these client
      methods** (additive, non-breaking; the underlying
      `pending.register` already accepts a signal):
  - [ ] `ARCPClient.connect(transport, opts?)` — currently no opts
        bag; add `{ signal? }`.
  - [ ] `ARCPClient.resume(transport, resume, opts?)` — same.
  - [ ] `ARCPClient.send(env, opts?)` — same.
  - [ ] `ARCPClient.ack(seq, opts?)` — same.
  - [ ] `ARCPClient.cancelJob(jobId, options)` — already takes
        `{ reason? }`; add `signal?`.
  - [ ] `ARCPClient.listJobs(filter?, opts)` — already takes
        `{ limit?, cursor? }`; add `signal?`.
  - [ ] `ARCPClient.subscribe(jobId, opts)` — already takes
        `{ history?, fromEventSeq? }`; add `signal?`.
  - [x] `ARCPClient.submit(opts: SubmitOptions)` — `SubmitOptions`
        already includes `signal?: AbortSignal`.
- [x] `@typescript-eslint/no-floating-promises` enabled and clean.
- [x] No `async` constructors found.
- [x] No empty catches found in initial inventory.
- [ ] Bound any unbounded `Promise.all` over user-supplied input —
      verify by reading runtime/job-runner.ts (deferred to during
      sub-phase 2.5 split).

---

## Sub-phase 2.5 — Complexity reduction (files >300 lines)

Sorted largest first. Each entry is its own checkpoint.

- [ ] `packages/runtime/src/server.ts` — **1290 lines** (was 1912;
      dropped after recovering the user's WIP into `8227bda`, which
      extracted `agent-registry.ts`, `job-runner.ts`, `stores.ts`).
      Still the largest violation. Further splits to identify in
      sub-phase 2.5.
- [ ] `packages/runtime/src/job-runner.ts` — **565 lines** (newly
      added in the WIP recovery; over the 300-line cap).
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

### Function-level complexity (measured by ESLint, 2026-05-14)

Total: **79 errors across 12 files**. Breakdown:

- `max-lines-per-function`: 28 functions
- `max-depth`: 22 occurrences
- `complexity`: 20 functions
- `max-lines`: 5 files
- `max-params`: 4 functions

Files with violations (each is its own checkpoint inside 2.5):

- [ ] `packages/runtime/src/server.ts` (1290 lines)
- [ ] `packages/runtime/src/job-runner.ts` (565 lines)
- [ ] `packages/runtime/src/job.ts` (589 lines)
- [ ] `packages/runtime/src/lease.ts` (430 lines)
- [ ] `packages/client/src/client.ts` (822 lines)
- [ ] `packages/core/src/messages/execution.ts` (593 lines)
- [ ] `packages/core/src/store/eventlog.ts` (303 lines)
- [ ] `packages/core/src/transport/websocket.ts` (function-level)
- [ ] `packages/core/src/state/session.ts` (function-level)
- [ ] `packages/core/src/util/json-schema.ts` (function-level)
- [ ] `packages/middleware/bun/src/index.ts` (function-level)
- [ ] `packages/middleware/otel/src/index.ts` (function-level)

### Circular imports (G4)

- [ ] **6 circular dependencies in `@arcp/runtime`**
      (`madge --circular`):
  1. `types.ts > job.ts > types.ts`
  2. `agent-registry.ts > types.ts > server.ts > agent-registry.ts`
  3. `types.ts > server.ts > job-runner.ts > lease.ts > types.ts`
  4. `server.ts > job-runner.ts > server.ts`
  5. `types.ts > server.ts > job-runner.ts > types.ts`
  6. `types.ts > server.ts > types.ts`
  Root cause: `runtime/src/types.ts` declares interfaces that the
  server depends on, and the server is referenced back by the
  collaborators (`job-runner`, `agent-registry`) for context. To
  break: extract pure types into a leaf module (`runtime/src/api.ts`
  or similar) that no other runtime file imports from `server.ts`.

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
