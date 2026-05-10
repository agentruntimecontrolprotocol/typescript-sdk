# Phase 1 — Discovery & Inventory

Counts produced by grep against `src/`, `test/`, `examples/` (78 `.ts` files). Discovered violations are listed with `path:line` excerpts; not all sites are reproduced — first ten per category, more if they form a single cluster worth seeing whole.

## Tally

| Category | Count | Distribution |
| --- | --- | --- |
| **1.1 Type-system** | | |
| `: any` annotations / `any` in generics | **0** | — |
| `as <Type>` (excludes `as const`) | **75** | src 73, test 2 |
| `as const` | 75 | informational, not a violation |
| `as unknown as X` (double-cast) | **18** | src 17, test 1 |
| `!` non-null assertions | **0** | (Biome `noNonNullAssertion: error`) |
| `// @ts-ignore` | 0 | |
| `// @ts-expect-error` | **1** | `test/integration/artifact.test.ts:65` — annotated, testing rejection of invalid input |
| `Function`, `Object`, `{}` as types | **0** | |
| Empty interfaces | **0** | |
| `enum` / `const enum` | **0** | |
| `namespace` / `module` | **0** | |
| Implicit-any params | **0** | (`strict` enforces `noImplicitAny`) |
| **1.2 tsconfig gaps** | | See preflight — all Phase 2 flags except `esModuleInterop` are on |
| **1.3 Module hygiene** | | |
| Default exports | **0** | |
| `export *` re-exports | **10** | one in `src/index.ts`, nine in `src/messages/index.ts` |
| Mixed-mode imports needing `import type` | **0** | enforced by Biome `useImportType: error` |
| Circular cycles | not measured | tooling not installed; deferred unless Phase 4/5 surfaces one |
| **1.4 Naming** | | |
| `I`-prefixed interfaces | **0** | |
| `T`-prefixed type aliases | **0** | |
| Non-PascalCase types/classes | **0** | |
| **1.5 Functions** | | |
| Exported funcs missing return type | **9** | listed below |
| Exported `async` funcs missing `Promise<T>` | **0** | only one exported async function (`startWebSocketServer`) and it has a return type |
| Function overloads | **0** found | |
| Callbacks typed as `Function` | **0** | |
| **1.6 Async** | | |
| Floating promises | not exhaustively measured | Biome lacks the rule. Manual scan of `void <expr>;` shows 10 explicit fire-and-forget sites — all look intentional. |
| `async` with no `await` | **0** found | (sample-checked the 30 async functions) |
| Sequential `await` on independent promises | **see 1.6 below** | candidates exist but most are deliberately ordered |
| `Promise.all` / `allSettled` usage | **0** | absence is itself a signal |
| **1.7 Errors** | | |
| `throw` of non-Error | **0** | the two `throw this.failure` sites in `runtime/stream.ts` re-throw a stored `Error` |
| `catch (e)` without explicit annotation | **23** | safe under `useUnknownInCatchVariables`; narrowing audit below |
| Generic `Error` instantiations where domain class would be clearer | **0** | rich domain hierarchy already exists in `src/errors.ts` |
| **1.8 Classes** | | |
| Classes total | 37 | |
| `private` keyword | 97 sites | codebase-wide convention |
| `#` private fields | 0 | consistent with the convention above |
| `readonly` fields | 118 sites | already pervasive |
| Override methods missing `override` | **0** | (`noImplicitOverride` enforces) |
| Empty constructors | **0** found | |
| **1.9 Generics** | | |
| Generics named only `T`/`U`/`V` in non-trivial positions | **handful** — see 1.9 below |
| Unconstrained generics | **0** flagged | sample-checked |
| **1.10 Index sigs / records** | | |
| `[key: string]: any` | **0** | |
| `Record<string, any>` | **0** | |
| `Object.keys(obj)` then index-into | **1 location** | `src/envelope.ts:107` — already cast to `Array<keyof T>` (not blanket-`any`) |

## 1.1 Type assertion clusters (the only meaningful Phase 4 work)

### Cluster A — `as unknown as WireFrame` (17 sites)

A single design seam: `Transport.send(frame: WireFrame)` where `WireFrame = Record<string, unknown>`, called from places holding a `BaseEnvelope` (Zod-inferred discriminated union). Under `exactOptionalPropertyTypes` an envelope's optional fields aren't structurally compatible with a generic `Record<string, unknown>`, so every send-site goes through the double cast.

Locations:

- `src/runtime/server.ts:105`, `:129`, `:600`, `:912`
- `src/client/client.ts:138`, `:168`, `:239`, `:283`, `:315`, `:358`, `:390`, `:413`, `:429`, `:450`, `:470`, `:813`
- `src/messages/index.ts:52` is *not* this cluster — see Cluster C.

**Fix shape (one design decision, then mechanical):** introduce a single boundary helper `toWire(env: BaseEnvelope): WireFrame` that performs one cast in one place, OR widen `WireFrame` to `BaseEnvelope | Record<string, unknown>` so transports can accept either without an assertion at the call site. Either change collapses all 17 violations into one well-named line.

### Cluster B — `as BaseEnvelope` after build/dispatch (≈40 sites in `src/runtime/`)

Locations include `src/runtime/job.ts:164,176,189,206,217,228,245,262,325`; `src/runtime/server.ts:661,693,721,818,828,864`; `src/runtime/stream.ts:84,98,112,134`. Pattern: an envelope is constructed via `buildEnvelope(...)` or a typed schema and then handed to a method whose parameter is typed `BaseEnvelope`. The local return type of `buildEnvelope` is narrower than `BaseEnvelope`, forcing the assertion.

**Fix shape:** broaden `buildEnvelope`'s return type or have it return `BaseEnvelope` directly when the caller doesn't need the narrower type. Worth scoping — needs a read of `envelope.ts:139` to confirm the return signature is the root cause.

### Cluster C — Zod tuple workaround (1 site)

`src/messages/index.ts:52` — `ALL_ENVELOPES as unknown as readonly [...]`. Comment in the file admits it's a Zod requirement. Fixable by typing `ALL_ENVELOPES` explicitly as a non-empty readonly tuple, or by constructing the discriminated union differently. Single-site fix.

### Other isolated `as` casts in src

- `src/envelope.ts:107` — `Object.keys(obj) as Array<keyof T>` — standard TS hole; leave or extract a `keysOf<T>` helper.
- `src/transport/websocket.ts:33`, `src/transport/stdio.ts:76` — `parsed as WireFrame` after `JSON.parse`. Replace with `parsed: unknown` plus a type guard / Zod parse at the boundary.
- `src/util/json-schema.ts:81,102,103` — recursive descent into JSON Schema with `Record<string, unknown>` casts. Each could be replaced with a discriminated `JsonSchema` type, but the cost may exceed the gain — assess after Cluster A/B.
- `src/runtime/pending.ts:70,86` — generic-erasure casts to `PendingEntry<unknown>` / `PendingEntry<T>`. The registry is heterogeneous by design; the casts are bounded. Consider declaration-merging trick or a typed map keyed by correlation id, otherwise leave with a comment.
- `src/runtime/session.ts:142,153,155` — three `(out as Record<string, unknown>)[k] = …` writes inside a merge function. Refactor by typing `out` as `Record<string, unknown>` from the start.
- `src/store/eventlog.ts:149,167,181,193,242` — better-sqlite3 returns `unknown`; casts go to `EventRow` / `BaseEnvelope`. The right fix here is a runtime guard (Zod parse) rather than a static cast — this is the *one* spot in the codebase where assertions are masking an actual trust boundary.
- `src/client/client.ts:489,672,725,751,778,788,871` — assorted: payload narrowing in handlers (legit candidate for type guards), and `asEnvelopeOfType` (a deliberate type-guard helper, OK).

### `as` in test/

- `test/integration/handshake.test.ts:170` — `replayed as Parameters<typeof h.client.send>[0]` — testing a re-sent envelope. Out-of-scope per "do not touch test fixtures except to make them type-check".
- `test/unit/eventlog.test.ts:115` — `env as BaseEnvelope`. Same.
- `test/integration/artifact.test.ts:65` — sole `@ts-expect-error`, deliberately invalid encoding to test rejection. Leave as-is.

## 1.5 Exported functions missing return types

| Location | Notes |
| --- | --- |
| `src/envelope.ts:126` `messageEnvelope<T, P>` | factory returning a Zod schema; inferred type is intentional and complex. Annotating may force ergonomic loss — assess whether `ReturnType` of the factory is what consumers actually rely on. |
| `src/envelope.ts:139` `buildEnvelope<T, P>` | returns the constructed envelope; root cause of Cluster B. Annotation here likely shrinks Cluster B significantly. |
| `src/extensions.ts:171` `classifyUnknownType` | trivial; annotate. |
| `src/transport/websocket.ts:138` `startWebSocketServer` | returns a `WebSocketServerHandle`; annotate. |
| `src/transport/memory.ts:88` `pairMemoryTransports` | already declares `[MemoryTransport, MemoryTransport]` in the body — verify whether grep miscounted. |
| `src/util/timers.ts:5` `safeSetTimeout` | already declares `: () => void` in the body — verify. |
| `src/util/timers.ts:14` `safeSetInterval` | already declares `: () => void` — verify. |
| `src/util/json-schema.ts:31` `validateAgainstSchema` | annotate to `string[]` (or a richer `ValidationIssue[]`). |
| `src/client/client.ts:867` `asEnvelopeOfType` | type-guard returning `Extract<…> \| null`; annotate. |

Three of those nine likely show as false positives because the regex required the colon on the same physical line as the `function` keyword; they actually have annotations on the next line. The five that need annotations are real and worth a single commit.

## 1.6 Sequential awaits worth examining (Phase 9 candidates)

`src/runtime/server.ts` lines 597–721 contain a replay loop where order matters (event log replay must preserve sequence) — leave sequential.

`src/runtime/subscription.ts:122–185` and `src/cli.ts:145–168` are similar — loop bodies that emit/forward events to subscribers; ordering may matter per consumer.

The codebase has **zero** `Promise.all` calls. That is striking: it means there are no places where independent IO is currently parallelized. Whether that's a missed optimization or a deliberate "preserve causal order" stance is a judgment call. Recommend: **do not refactor here** in this pass. It's a behavior change disguised as a style fix.

## 1.7 Catch-block narrowing audit (sample of 23)

Spot-checked five sites. All five rely on Node-conventional behavior: log via `String(err)` or `err instanceof Error ? err.message : String(err)`, or wrap into a domain `ARCPError`. Under `useUnknownInCatchVariables` (already on via `strict`), the implicit `unknown` annotation is correct and the narrowings are valid. **No work required.**

## 1.9 Generic parameter naming

Quick sample identified ≤6 sites where a single-letter `T` could read as `TPayload` / `TInput` / `TOutput`. None are in the public API surface. Low priority; defer.

## What's actually worth doing

Based on the data above, only **four** of the prompt's thirteen phases will produce a real diff in this codebase:

1. **Phase 4 (assertions) — high value.** Fix Cluster A by introducing `toWire()` (one helper, deletes 17 casts). Fix Cluster B by tightening `buildEnvelope`'s return type (likely deletes ≈40 casts). Fix Cluster C by typing `ALL_ENVELOPES` as a non-empty readonly tuple. Each is a single-commit change.

2. **Phase 5 (`export *` barrels) — discuss first.** The chained barrel `src/index.ts → src/messages/index.ts → 9 leaves` is exactly the anti-pattern called out, but it is also the package's public message-type surface. Removing it is a public-API churn; the cost may exceed the tree-shaking benefit for a Node-only library. Recommend: **leave**, document the choice.

3. **Phase 7 (return types) — small.** Annotate the 5 genuinely missing return types in `envelope.ts`, `extensions.ts`, `transport/websocket.ts`, `util/json-schema.ts`, `client/client.ts`. One commit.

4. **Phase 8 (errors) — narrow.** Replace the 5 `as` casts on `better-sqlite3` results in `store/eventlog.ts` with Zod parses at the trust boundary. One commit.

Phases 2, 3, 6, 10, 11, 12 are essentially complete already — there is nothing to do, and that is itself the report. Phase 13 still applies as the gating check after each commit.

## Stop point

Per the prompt's "Stop after Phase 1" rule, no mutations have been made beyond creating `.refactor/00-preflight.md` and this file. Awaiting review before proceeding to Phase 4.
