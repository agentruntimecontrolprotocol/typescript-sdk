# Baseline (2026-05-14, refactor/automation @ initial commit)

Captured before any refactor work. This is the safety net — the
refactor must preserve or improve every metric below.

## Repository

- Workspace: pnpm (10 packages: 4 main + 1 meta + 5 middleware + 1
  otel)
- Node engine: `>=22`
- Package manager: pnpm@9.15.0
- TS: 5.6.2
- Lint: biome@2.4.15 + eslint@9.39.4 (typescript-eslint strict +
  unicorn + import + n)
- Test: vitest@2.1.2

## Packages (all `private: false`, all publish to npm)

| Package                    | path                          | barrel size (.d.ts lines) |
| -------------------------- | ----------------------------- | ------------------------: |
| `@arcp/core`               | `packages/core`               |  12 (+ 12 subpath barrels) |
| `@arcp/client`             | `packages/client`             |   2 |
| `@arcp/runtime`            | `packages/runtime`            |   5 |
| `@arcp/sdk`                | `packages/sdk`                |   3 (+ 5 subpath barrels) |
| `@arcp/bun`                | `packages/middleware/bun`     |  25 |
| `@arcp/express`            | `packages/middleware/express` |  38 |
| `@arcp/fastify`            | `packages/middleware/fastify` |  38 |
| `@arcp/hono`               | `packages/middleware/hono`    |  38 |
| `@arcp/node`               | `packages/middleware/node`    |  29 |
| `@arcp/middleware-otel`    | `packages/middleware/otel`    |  11 |

Source size: 87 `.ts` files, ~10,666 LOC.

## Baseline gates (state at start of refactor)

| Gate | Command          | Result                                        |
| ---- | ---------------- | --------------------------------------------- |
| G1   | `pnpm typecheck` | PASS (0 errors)                               |
| G2   | `pnpm lint`      | PASS (after biome ignore added for `.refactor`) |
| G3   | `pnpm test`      | PASS (all suites)                             |

### Test counts (per package)

- `@arcp/core`: 6 files, 45 tests
- `@arcp/client`: 4 files, 38 tests
- `@arcp/runtime`: 1 file, 18 tests
- `@arcp/sdk`: 0 tests (passWithNoTests)
- `@arcp/bun`: 0 tests
- `@arcp/express`: 0 tests
- `@arcp/fastify`: 1 file, 2 tests
- `@arcp/hono`: 0 tests
- `@arcp/node`: 0 tests
- `@arcp/middleware-otel`: 1 file, 2 tests

**Total: ~14 test files, ~105 tests passing.**

> Test coverage on the middleware packages is thin. Sub-phase 2.7
> (Testing) will need to add coverage there before final gates close.

## Known dirty-tree items handled before baseline

See `wip-handling.md`. The runtime work-in-progress was stashed
(non-destructively) before this baseline was taken. None of those
files are reflected in the metrics above.

## tsconfig.base.json conformance to guide Section 0

Already enabled: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`,
`noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`,
`isolatedModules`, `forceConsistentCasingInFileNames`.

Missing: `useUnknownInCatchVariables` (will be added in sub-phase 2.1).

Target: ES2023 (guide minimum is ES2022 — already exceeds).

## package.json conformance to guide Section 9

Already conformant across all 10 packages: `"type": "module"`,
`"sideEffects": false`, `"exports"` map (with `types` and `import`
conditions, no wildcards), `engines.node`, `publishConfig.provenance:
true`, `main`/`types` legacy fallback for old resolvers.
