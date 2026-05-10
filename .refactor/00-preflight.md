# Pre-flight Report

## Repository state

- **Working directory:** `/Users/nficano/code/arpc/typescript-sdk/arcp`
- **Git:** existing repository, clean working tree at `704f4d0` ("phase 7: CLI, examples, README, CONFORMANCE, e2e relay") on `main`. Branched to `chore/idiomatic-ts`. No `origin` remote configured — incremental push is not possible from this machine; commits will accumulate on the local branch.
- **Scope:** this single package only. The parent `/Users/nficano/code/arpc/` contains 11 other SDK directories (csharp, fsharp, go, java, kotlin, php, python, ruby, rust, swift, plus the `agent-runtime-control-protocol` spec); they are out of scope.

## Package metadata

- **Name / version:** `arcp@0.1.0` — declared `version` is below 1.0 but the package has a populated `exports` map and a `bin`. Treat the API surface as semi-public: avoid renames in re-exported identifiers without a paired note.
- **Module system:** ESM only (`"type": "module"`, `"module": "NodeNext"`). No CJS dual build.
- **Engines:** `node >=22`. Targets a single modern runtime. `target: "ES2023"`, `lib: ["ES2023"]`, `types: ["node"]` — Node-only, no DOM.
- **Package manager:** pnpm (lockfile is `pnpm-lock.yaml`).
- **Published?** Not published yet (no `publishConfig`, version `0.1.0`, no `prepublish*` script). Type-only renames are low-risk; behavior changes still need care because external SDKs interop over the wire protocol.

## Tooling

- **Type checker:** `tsc -p tsconfig.json --noEmit` (script: `typecheck`). Build uses a separate `tsconfig.build.json` that narrows `rootDir` to `src/` and excludes test/examples.
- **Linter / formatter:** **Biome 2.x** (`biome.json`). Not ESLint. Phase 12 of the input prompt is written for `typescript-eslint`; mappings to Biome equivalents will be called out per rule rather than wholesale-adopted.
- **Tests:** Vitest 2.x. Coverage thresholds: lines/functions/statements 85, branches 75. Coverage excludes `src/cli.ts`, `src/index.ts`, declarations.
- **Pre-commit hook:** `simple-git-hooks` runs `pnpm lint && pnpm test`. The hook will gate every commit during the refactor.

## tsconfig — strict baseline status

The active `tsconfig.json` already enables nearly the entire Phase 2 baseline:

| Flag | Status | Note |
| --- | --- | --- |
| `strict` | on | implies `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `alwaysStrict`, `useUnknownInCatchVariables` |
| `noUncheckedIndexedAccess` | on | |
| `noImplicitOverride` | on | |
| `noFallthroughCasesInSwitch` | on | |
| `noImplicitReturns` | on | |
| `exactOptionalPropertyTypes` | on | |
| `isolatedModules` | on | |
| `verbatimModuleSyntax` | on | |
| `forceConsistentCasingInFileNames` | on | |
| `skipLibCheck` | on | |
| `noPropertyAccessFromIndexSignature` | on | extra strictness, not in the prompt baseline but kept |
| `esModuleInterop` | **off** | combined with `allowSyntheticDefaultImports: true`. Deliberate; revisit only if real interop friction appears. |

**Implication:** Phase 2 ("flip flags one-by-one") is essentially a no-op for this package — the work is already done. The remaining type-system risks live in user code, not in compiler config.

## Lint baseline

Biome rules already enabled that overlap the Phase 12 baseline:

- `suspicious/noExplicitAny: error`
- `style/noNonNullAssertion: error`
- `style/useImportType: error`
- `style/useExportType: error`
- `style/useNodejsImportProtocol: error`
- `correctness/noUnusedImports: error`
- `correctness/noUnusedVariables: error`
- `suspicious/noConsole: error` (with `allow: ["error"]`, off in `cli.ts` and `examples/`)

Biome **does not** offer direct equivalents for several typescript-eslint type-aware rules (e.g. `no-floating-promises`, `no-misused-promises`, `await-thenable`, `no-unnecessary-type-assertion`, `restrict-template-expressions`, `switch-exhaustiveness-check`). Adding `typescript-eslint` alongside Biome would duplicate tooling. Recommendation: catch those categories via targeted code review during Phase 9 instead of introducing a second linter.

## Stated conventions

`README.md`, `CONFORMANCE.md`, and `RFC-0001-v2.md` describe protocol semantics, not code conventions. No `CONTRIBUTING.md` or `docs/architecture*` files exist. The codebase's own conventions (inferred from grep): `private` keyword over `#`-private (97:0), named exports only, ESM `.js` import specifiers everywhere, type-only imports already pervasive, classes for stateful runtime components and Zod schemas for wire types.

## Baseline check (HEAD of `main`, before any changes)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean (84 files) |
| `pnpm test` | 232/232 passing across 26 test files |
| `pnpm build` | not run yet (no diff to validate) |

## Code volume

- 78 `.ts` files in `src/` + `test/` + `examples/`
- ~10,849 lines (src 6,791 / test 3,635 / rest in examples)

## Risk assessment

The refactor's expected mechanical wins (Phase 2 strict flags, default-export removal, enum migration, `IUser` renames, `any` purge) are all already done. What remains is judgment work:

1. The transport boundary uses `as unknown as WireFrame` and `as BaseEnvelope` clusters as a deliberate type bridge between Zod-inferred discriminated unions and `Record<string, unknown>`. These read like Phase 4 violations, but each individual cast is locally correct — they exist because `WireFrame = Record<string, unknown>` does not structurally accept envelopes under `exactOptionalPropertyTypes`. Eliminating them requires a single design change (widen `WireFrame` or introduce a one-line helper), not site-by-site rewrites.

2. `src/messages/index.ts` uses `export *` from 9 sub-modules and then `src/index.ts` re-exports the barrel with another `export *`. That is a pattern Phase 5 advises against, but reversing it would touch every public message-type identifier. Worth pricing before doing it.

3. `src/messages/index.ts:52` has the only true "double-cast smell" outside the transport layer (`ALL_ENVELOPES as unknown as readonly [...]`) — likely a Zod typing workaround that should be possible to eliminate cleanly.

## Plan

Phase 1 inventory follows in `01-inventory.md`. After that, **stop and request review** before mutations, per the input prompt's "Stop after Phase 1" rule. The phases that will produce real diffs in this codebase are 4 (assertions), 5 (barrels — only with approval), 7 (a handful of explicit return types), and 9 (await-in-loop audit). Most other phases have nothing to do here.
