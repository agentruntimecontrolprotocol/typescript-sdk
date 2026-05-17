# TypeScript SDK Guide — Opinionated, Idiomatic, Maintainable

> Target: public SDKs (libraries consumed by external developers).
> Audience: Claude Code agents performing greenfield work, refactors, and
> reviews. Treat every rule as a hard rule unless explicitly marked SHOULD.
> Reject diffs that violate MUST rules.

---

## 0. Non-negotiables

- **MUST** enable `"strict": true`, plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`,
  `useUnknownInCatchVariables`, `isolatedModules`, `verbatimModuleSyntax`.
- **MUST** target `ES2022` minimum; emit ESM as primary, dual-publish CJS
  via `exports` conditions only when consumers demand it.
- **MUST** ship `.d.ts` types alongside JS; never publish source `.ts`.
- **MUST NOT** use `any`. Use `unknown` and narrow. If `any` is truly
  required, isolate it behind a single audited helper with a comment
  explaining why.
- **MUST NOT** use `// @ts-ignore`. Use `// @ts-expect-error <reason>`
  so the suppression breaks the build when no longer needed.
- **MUST NOT** use `enum`, `namespace`, parameter properties on classes,
  decorators (unless framework-required), or `default` exports.
- **MUST** use named exports only — they refactor cleanly, tree-shake,
  and prevent accidental rename drift across consumers.

---

## 1. Type system rigor

- Prefer **discriminated unions** over class hierarchies and over
  optional-field grab-bags. Tag with a literal `kind` or `type` field.
- Use **branded types** for IDs and opaque values:
  `type UserId = string & { readonly __brand: "UserId" }`.
  Construct via a single validator; never cast at call sites.
- Use **`readonly`** on every field, array, tuple, and map by default.
  Mutability is opt-in, not opt-out. `ReadonlyArray<T>` over `T[]` in
  signatures.
- Use **`as const`** for literal data; derive types with
  `typeof X[number]`.
- Replace `enum` with string literal unions or `as const` objects:
  ```ts
  export const LogLevel = {
    Debug: "debug",
    Info: "info",
    Warn: "warn",
    Error: "error",
  } as const;
  export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];
  ```
- Use **`satisfies`** to validate shapes without widening; do not
  annotate when `satisfies` is correct.
- Reach for utility types (`Pick`, `Omit`, `Extract`, `Exclude`,
  `NonNullable`, `Awaited`) before hand-rolling. Build small named
  helpers (`type NonEmpty<T> = [T, ...T[]]`) rather than inlining
  clever generics.
- Generics: constrain every parameter (`<T extends Foo>`); single-letter
  names only when role is obvious (`T`, `K`, `V`, `E`); otherwise use
  descriptive names (`TPayload`, `TResponse`).
- Function overloads: only when the relationship between input and
  output types cannot be expressed in a single signature. Otherwise
  use conditional types or union returns.

---

## 2. Public API surface

- **One barrel file**: `src/index.ts` is the only public entry point.
  Everything else is internal. Enforce via `package.json` `"exports"`
  field — no `"./*"` wildcards.
- **Every public symbol** has an explicit return type annotation.
  Internal helpers may infer. This stabilizes the wire format of the
  SDK against accidental type widening.
- **Public types are nominal where it matters**: brand IDs, tokens,
  URLs, dates. Avoid leaking `Record<string, unknown>` — define a
  shape or accept `unknown` and validate.
- **No leaking internal types**: anything not in `index.ts` is not
  part of the contract. Mark internal helpers `@internal` in TSDoc;
  configure the API extractor to strip them from `.d.ts`.
- **Options objects** for any function with >2 parameters or any
  optional parameter. Required first, optional bag last. Never
  positional booleans.
- **No default arguments in public APIs that change behavior**.
  Defaults are fine for ergonomics (timeouts, retries); document
  every default in TSDoc.
- **Stability**: every breaking change to a public symbol = major
  version bump. Internal refactors must not change `.d.ts` output.
  Diff `.d.ts` in CI.

---

## 3. Errors

- **MUST** subclass `Error`, set `name`, and forward `cause`:
  ```ts
  export class RateLimitError extends Error {
    readonly name = "RateLimitError";
    constructor(
      message: string,
      readonly retryAfterMs: number,
      options?: { cause?: unknown },
    ) {
      super(message, options);
    }
  }
  ```
- **MUST** expose every error class from the public barrel so consumers
  can `instanceof`-check. Provide a discriminated union type
  `SdkError = RateLimitError | NetworkError | ValidationError | ...`.
- **SHOULD** prefer returning result objects for expected, recoverable
  outcomes (parse, validate, find); throw for programmer error and
  unrecoverable failures. Do not mix both for the same function.
- **MUST NOT** throw plain strings, numbers, objects, or `Error`
  without a specific subclass.
- **MUST** preserve `cause` chains across layers — never swallow the
  original error.
- **MUST NOT** log inside library code. Surface errors; let consumers
  decide. Provide an optional logger hook if observability is needed.

---

## 4. Async, cancellation, concurrency

- **MUST** accept `AbortSignal` on every async public function that
  performs I/O. Honor it; throw `DOMException("...", "AbortError")`
  or a typed `AbortError` subclass.
- **MUST NOT** create floating promises. Enable
  `@typescript-eslint/no-floating-promises`. Either `await`, return,
  or explicitly `void` with a comment.
- **MUST NOT** swallow rejections. No empty `.catch(() => {})`.
- Prefer `async/await` over `.then`. Mix only when composing with
  legacy promise utilities.
- **No `async` constructors** — use static factory methods returning
  `Promise<T>`.
- Bound concurrency explicitly (`p-limit`, semaphore, queue). Never
  fire-and-forget `Promise.all` over user-supplied arrays.
- Time is injected, never imported: pass `now()` and `setTimeout`
  through an options object or a clock abstraction for testability.

---

## 5. Module & file structure

- **One concept per file.** A file exports one class, one factory,
  or one tightly related cluster of pure functions. If you can't
  name the file in two words, split it.
- **No circular imports.** Enforce with `eslint-plugin-import` or
  `madge` in CI.
- **Side-effect-free modules**: top-level code does nothing but
  declare. No `console.log`, no fetch, no mutation. Enables
  tree-shaking and predictable load order. Mark
  `"sideEffects": false` in `package.json`.
- **Internal layout**:
  ```
  src/
    index.ts          # public barrel ONLY
    client.ts         # entry class/factory
    errors.ts         # error subclasses
    types.ts          # public type aliases
    internal/         # everything not exported
      http.ts
      retry.ts
      ...
  ```
- **Test files** live next to source as `*.test.ts`, not in a separate
  tree. Co-location speeds refactors.

---

## 6. Naming

- **Files**: `kebab-case.ts`. Test files: `kebab-case.test.ts`.
- **Types/interfaces/classes**: `PascalCase`. No `I` prefix on
  interfaces. No `T` prefix on types.
- **Functions/variables**: `camelCase`. Constants that are truly
  module-level immutable primitives may be `SCREAMING_SNAKE`.
- **Booleans**: prefixed `is`, `has`, `should`, `can`, `did`.
- **Async functions**: no `Async` suffix; the return type says it.
- **Avoid abbreviations** in public APIs (`config` not `cfg`,
  `request` not `req`). Internal hot loops may abbreviate.
- **No Hungarian notation.** No type info in names (`userArr`,
  `nameStr`).

---

## 7. Documentation (TSDoc)

- **Every public export** has a TSDoc block: one-sentence summary,
  `@param` for each parameter, `@returns`, `@throws` for each
  thrown error class, `@example` for non-trivial usage, `@see`
  for related symbols.
- **Mark stability**: `@public`, `@beta`, `@alpha`, `@internal`,
  `@deprecated <replacement>`.
- **Never duplicate type info in prose** ("the string name of the
  user"). Document _meaning_, _invariants_, _side effects_.
- **Examples must compile.** Run them through `tsd` or
  `eslint-plugin-tsdoc` in CI.

---

## 8. Dependencies

- **Zero runtime dependencies** is the goal; every dep is a liability
  for consumers (audit surface, bundle size, version conflicts).
- **Peer-dep** anything a consumer is likely to already have
  (framework runtimes, `react`, `zod`, etc.). Specify wide ranges;
  pin in your own lockfile only.
- **Never bundle deps into your published artifact** unless they are
  trivially small and you own them.
- **No polyfills shipped in the SDK.** Document required runtime.
- Use `devDependencies` aggressively; consumers never see them.
- **`type-fest`** is acceptable as a dev-dep for type plumbing;
  don't re-export its types.

---

## 9. Build & distribution

- **MUST** ship ESM (`"type": "module"`). Provide CJS only if
  measurable demand exists, via `exports` conditions.
- **MUST** populate `package.json` `"exports"` with `import`,
  `require` (if dual), `types`, and `default`. Do not rely on
  `"main"` / `"types"` alone for modern resolvers.
- **MUST** ship sourcemaps (`.js.map`) and declaration maps
  (`.d.ts.map`); include `src/` in the published tarball so
  go-to-definition lands on TS, not generated JS.
- **MUST** set `"sideEffects": false` (or list exactly which files
  have side effects).
- **MUST** include `engines.node` and document supported runtimes
  (Node, Bun, Deno, browsers, Workers).
- **MUST** add `provenance: true` on publish; sign artifacts.
- Use `tsup`, `unbuild`, or `tsc` directly. Avoid Webpack for
  library output. Verify output with `@arethetypeswrong/cli` in CI.

---

## 10. Testing

- **Vitest** preferred (fast, ESM-native, TS-native). Jest acceptable
  for legacy.
- **Type tests** with `expectTypeOf` / `tsd` for every public
  generic. Type regressions are silent — test them.
- **No mocking of your own modules.** Inject dependencies. If you
  must mock, it's a design smell.
- **Snapshot tests** only for stable, human-readable output
  (formatted strings, generated code). Never for objects.
- **Public API smoke test**: import only from the barrel; verify
  every exported symbol exists and has the documented shape.
- **Coverage** is a smell detector, not a goal. Target paths, not
  percentages.

---

## 11. Complexity & size limits (hard caps)

These are **enforced limits**, not aspirations. Failing CI is the
correct response.

| Metric                    | Max |                   Aspire |
| ------------------------- | --: | -----------------------: |
| Line length (chars)       | 100 |                       80 |
| Function body (lines)     |  40 |                     ≤ 20 |
| File length (lines)       | 300 |                    ≤ 150 |
| Function parameters       |   3 | ≤ 2 (use options object) |
| Cyclomatic complexity     |  10 |                      ≤ 5 |
| Nesting depth             |   3 |                      ≤ 2 |
| Generic type parameters   |   3 |                      ≤ 2 |
| Public exports per barrel |  50 |            split if more |

- **One function does one thing.** If you need "and" to name it,
  split it.
- **Early returns / guard clauses** over nested conditionals. Flatten
  by inverting the predicate.
- **Extract on the second occurrence**, not the third. Duplication
  in a public SDK calcifies fast.
- **No clever code.** If a reviewer must run it in their head to
  follow it, rewrite. Cleverness is a tax on every future reader,
  including Claude.
- **Delete code aggressively.** Dead branches, "just in case"
  parameters, commented-out blocks — gone. Git remembers.

### Recommended ESLint config to enforce the above

```jsonc
{
  "rules": {
    "max-len": [
      "error",
      { "code": 100, "ignoreUrls": true, "ignoreStrings": true },
    ],
    "max-lines": [
      "error",
      { "max": 300, "skipBlankLines": true, "skipComments": true },
    ],
    "max-lines-per-function": ["error", { "max": 40, "skipBlankLines": true }],
    "max-params": ["error", 3],
    "max-depth": ["error", 3],
    "complexity": ["error", 10],
    "no-console": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/explicit-module-boundary-types": "error",
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { "fixStyle": "inline-type-imports" },
    ],
    "@typescript-eslint/consistent-type-exports": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/prefer-readonly": "error",
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "import/no-default-export": "error",
    "import/no-cycle": "error",
  },
}
```

---

## 12. Style cheatsheet (apply silently)

- Trailing commas everywhere.
- Single quotes for strings; backticks only when interpolating.
- Semicolons on.
- Imports sorted: node built-ins → external → internal → relative;
  blank line between groups. `import type` for type-only.
- No re-exports of internal modules from the barrel — only the
  curated public surface.
- `const` over `let`; `let` over `var` (never `var`).
- Arrow functions for callbacks; named `function` declarations for
  module-level helpers (hoisting + stack-trace readability).
- Object shorthand, spread over `Object.assign`, destructuring with
  defaults at the destructure site.
- No `else` after `return`. No ternary nesting. No bit-tricks in
  application code.

---

## 13. Quick reference (decision shortcuts)

- Need a type for a finite set? → `as const` object + union derive.
- Need an ID? → branded string with a validator.
- Need an error? → subclass with `name`, `cause`, and an exported
  class.
- Need an optional? → `T | undefined` (with
  `exactOptionalPropertyTypes`); avoid `T | null` unless interop
  forces it. Pick one and stick to it.
- Need a callback? → name it; type it; document it; never inline a
  complex type in a signature.
- Need configuration? → options object, required first, optional bag
  last, every default documented.
- Need to share code between SDK and app? → it does not belong in the
  SDK. Extract a third package.
