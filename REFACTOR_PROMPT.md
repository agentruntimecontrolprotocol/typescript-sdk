# Autonomous TypeScript SDK Refactor (Multi-Session)

You are refactoring this codebase to conform to
`TYPESCRIPT_SDK_GUIDE.md` at the repo root.

The refactor is too large to complete in one session. It is designed to
run across many sessions, each picking up where the previous left off.
Your job in any given session is to **make as much forward progress as
possible, end at a clean checkpoint, and leave a handoff the next
session can resume from without re-investigating anything.**

---

## Operating Mode

Hard rules for every session:

- **Do NOT ask the user for permission.** Not for plans, not for
  decisions, not for individual changes. The guide is your authority.
- **Do NOT pause for confirmation.** No "should I proceed?" check-ins.
- **Do NOT request clarification on judgment calls.** When the guide is
  silent or ambiguous, pick the option that best serves
  maintainability, document the choice in `.refactor/DECISIONS.md`,
  and move on.
- **Do stop at checkpoints.** A checkpoint is the boundary between two
  phases (or between two packages within a phase) — never mid-phase
  or mid-file. At a checkpoint you may end the session if context,
  time, or risk demands it.
- **Public API is sacred.** Do not change the shape of any symbol
  exported from a package barrel without recording it explicitly in
  `.refactor/breaking_changes.md`. Non-breaking changes are free;
  breaking ones are listed and deferred unless the user has approved
  them.
- **Do NOT mark the overall task complete until every gate condition
  in Phase 3 passes.** A session that ends at a checkpoint is not a
  failure — it is the expected mode of operation.

The user is unavailable during execution. Treat every decision as
yours to make.

---

## Multi-Session Execution Model

The refactor is driven by a small set of files under `.refactor/`. They
are the single source of truth for "where are we" and survive across
sessions.

| File                          | Purpose                                            | Owner            |
| ----------------------------- | -------------------------------------------------- | ---------------- |
| `.refactor/STATE.md`          | Current phase, current package, what's done, what's next | Updated each session |
| `.refactor/baseline.md`       | Initial typecheck/lint/test baseline (immutable after Phase 1) | Phase 1 only |
| `.refactor/api-snapshot/`     | Frozen `.d.ts` of every package barrel as of Phase 1 | Phase 1 only   |
| `.refactor/violations.md`     | Inventory of guide violations from Phase 1, with checkboxes | Updated as resolved |
| `.refactor/DECISIONS.md`      | Every judgment call, with one-line rationale       | Append-only      |
| `.refactor/breaking_changes.md` | Public surface changes that would break consumers; deferred until approved | Append-only |
| `.refactor/HANDOFF.md`        | Notes from the previous session to the next        | Rewritten each session |

These files live on the active refactor branch (default
`refactor/automation`). They are the contract between sessions.

### Session lifecycle

Every session follows the same lifecycle:

1. **Bootstrap.** Determine whether this is the first session or a
   resume (see "Bootstrap" below).
2. **Work.** Execute one or more phases (or packages within a phase).
   Stop at a phase or package boundary, never mid-file.
3. **Checkpoint.** Commit, update `STATE.md` and `HANDOFF.md`, decide
   whether to continue or end the session.
4. **Final report.** Only on the session that flips the last gate
   green — see Phase 4.

### Bootstrap

On entry, read `.refactor/STATE.md`.

- **If it does not exist:** this is the first session. Run Phase 1
  end-to-end, then proceed into Phase 2 starting at sub-phase 2.1.
- **If it exists:** read it, then read `.refactor/HANDOFF.md`. Do
  *not* re-investigate. Trust the state. Resume at the next
  unfinished sub-phase listed in `STATE.md`.

`STATE.md` MUST contain, at minimum:

```markdown
# Refactor State

- Branch: refactor/automation (based on <base-sha>)
- Phase: 2
- Current sub-phase: 2.5 (Complexity Reduction)
- Current package: @arcp/runtime
- Last completed sub-phase: 2.4 (Async hygiene)
- Last commit on branch: <sha>
- Gates passing: G1, G2
- Gates failing: G3 (12 files >300 lines), G4 (8 cyclomatic-complexity violations), G5 (api diff non-empty)
- Sessions consumed: 3
- Estimated remaining work: ~2 sessions for sub-phase 2.5, then 2.6–2.9
```

### Repository preconditions

Before any refactor work can begin, the repo must be in a known state:

- A clean working tree on the agreed base commit, OR
- An explicit `.refactor/wip-handling.md` note recording how prior
  uncommitted work was handled (committed as WIP, stashed, or
  branched-from-dirty).

If the working tree is dirty when bootstrap runs and no
`wip-handling.md` exists, stop immediately and write a short
`HANDOFF.md` describing the dirty files. Do not attempt the refactor
on top of unknown user work.

### When to stop a session

End the session at the next checkpoint when any of the following are
true:

- Context budget feels stretched (you are noticing reduced quality, or
  you have rolled past several long files).
- A sub-phase has just completed and the next sub-phase is large (a
  fresh session will execute it more reliably).
- All gates are green (proceed to Phase 4 instead of stopping).

Do **not** stop mid-sub-phase, mid-file, or with failing tests. The
repo must be in a green state at every session boundary: typecheck
clean, lint clean for the files you touched, tests passing, branch
committed.

---

## Phase 1: Investigation (First Session Only)

Read before you write. Skip this phase entirely if `.refactor/STATE.md`
already exists.

1. Read `TYPESCRIPT_SDK_GUIDE.md` in full. Internalize the hard limits
   in Section 0 and the complexity caps in Section 11.
2. Map the repository:
   - Identify the package layout (workspace? single package?), the
     public barrels per package, and any internal modules.
   - Locate `tsconfig.json`(s), `package.json`(s), ESLint/Biome
     config, build config, CI config.
   - Identify the test setup per package and how it runs.
   - List which packages publish to npm (private vs. public).
3. Snapshot the public API of every published package: write the
   compiled `.d.ts` of each barrel to `.refactor/api-snapshot/`,
   one file per package. This is the contract you must not break.
4. Run the existing typecheck, lint, and test suites. Record the
   baseline pass/fail in `.refactor/baseline.md`. This is your safety
   net — every change must preserve or improve it.
5. Inventory violations. Write `.refactor/violations.md` grouped by
   category, with a checkbox per item so future sessions can mark
   them resolved:
   - Files exceeding 300 lines (with current line count).
   - Functions exceeding 40 lines, complexity >10, params >3, or
     nesting >3.
   - Uses of `any`, `// @ts-ignore`, `enum`, `namespace`, `default`
     export, parameter properties, non-`PascalCase` types,
     abbreviated public names.
   - Public symbols missing explicit return type annotations.
   - Public symbols missing TSDoc.
   - Errors that are plain `throw new Error(...)` rather than typed
     subclasses.
   - Missing `AbortSignal` on public async I/O functions.
   - Floating promises and empty catches.
   - `package.json` issues: missing `exports` map, missing
     `sideEffects`, default exports in barrel, `main`/`types` only
     (no conditions), missing `provenance`.
   - Circular imports (run `madge --circular`).
6. Initialize `.refactor/STATE.md`, `.refactor/DECISIONS.md` (empty
   list), `.refactor/breaking_changes.md` (empty list), and
   `.refactor/HANDOFF.md` (empty).
7. Commit on the refactor branch:
   `chore(refactor): initialize state, snapshots, and inventory`.

When investigation is complete, proceed directly to Phase 2 in the
same session if context allows. Otherwise checkpoint and stop.

---

## Phase 2: Execution

Execute sub-phases in order. Within a sub-phase that touches multiple
packages, treat each package as the natural sub-unit and checkpoint
between packages if needed.

A sub-phase is **complete** only when:

- All bullets in the sub-phase are addressed for in-scope code across
  every package.
- Typecheck, lint, and tests pass for the touched code.
- The relevant items in `.refactor/violations.md` are checked off.
- A commit (or commits) for the sub-phase exist on the branch.
- `.refactor/STATE.md` is updated to mark the sub-phase complete.

If you cannot complete a sub-phase in the current session, do **not**
mark it complete. Stop at the previous sub-phase boundary (or at a
package boundary within the current sub-phase) and write a clear note
in `HANDOFF.md`.

### Sub-phase 2.1 — Tooling baseline

- Update every `tsconfig*.json` to the strict flag set in guide
  Section 0.
- Install/update ESLint with the rule set in guide Section 11.
- Install `@arethetypeswrong/cli`, `publint`, `madge`, and any
  missing dev tooling.
- Add CI steps: `tsc --noEmit` (or `tsc -b`), `eslint .`,
  `vitest run`, `attw --pack` per published package, `publint` per
  published package, `madge --circular src` per package.
- Commit: `chore(tooling): enforce strict ts, lint, and publish checks`.

### Sub-phase 2.2 — Surface audit

- Re-emit `.d.ts` for every package barrel; diff against
  `.refactor/api-snapshot/`.
- Identify every symbol that violates guide rules (default exports,
  `any`, missing return types, leaked internal types). Group into:
  - (a) fixable without breaking change → fix now;
  - (b) requires breaking change → append to
    `.refactor/breaking_changes.md`, leave the symbol untouched.
- After fixing (a), re-emit `.d.ts` and confirm the diff against the
  snapshot is empty (or limited to additions). Update the snapshot
  only with explicit user approval recorded in `DECISIONS.md`.
- Commit: `refactor(api): tighten public surface (non-breaking)`.

### Sub-phase 2.3 — Errors

- Convert all thrown values to typed error subclasses per guide
  Section 3.
- Export every error class from each package's barrel.
- Add a discriminated `SdkError` union per package (or one shared
  union if the guide indicates).
- Preserve `cause` chains; remove all swallowed catches.
- Add `@throws` TSDoc lines to every public function that can throw.
- Commit: `refactor(errors): typed hierarchy with cause preservation`.

### Sub-phase 2.4 — Async hygiene

- Add an optional `AbortSignal` parameter to every I/O public async
  function and plumb it through.
- Eliminate floating promises and empty catches.
- Replace any `async` constructor with a static factory.
- Bound any unbounded `Promise.all` over user input.
- Commit: `refactor(async): cancellation, no floating promises`.

### Sub-phase 2.5 — Complexity reduction (the core work)

This is the largest sub-phase and will commonly span multiple
sessions. Treat each *file* in the violations inventory as its own
sub-unit. A session may complete any number of files; partial-file
work is not a checkpoint. After each file:

- Re-run typecheck and tests for the affected package.
- Check off the file's entries in `.refactor/violations.md`.
- Commit with a focused message like
  `refactor(<package>): split <file> per guide Section 11`.
- Update the "files remaining" count in `STATE.md`.

For every violation in `.refactor/violations.md` for files >300
lines, functions >40 lines, complexity >10, params >3, or nesting
>3:

1. Read the file/function. Understand intent before cutting.
2. Apply, in order:
   - Extract guard clauses to the top (early returns).
   - Flatten nesting by inverting predicates.
   - Extract repeated blocks into private helpers.
   - Split flag-parameter functions into separate functions.
   - Convert >3-param signatures into options objects.
   - Split files >300 lines along responsibility lines, not
     arbitrarily.
3. Re-run tests after each file. Fix regressions immediately.
4. Re-measure with `eslint --rule '{...}'` or by reading the lint
   output. The target is zero violations.

Do not exempt any code. If you cannot refactor a function under the
limit, you have not understood it yet. Re-read and try again. Only
add `// eslint-disable-next-line` as a last resort with a comment
explaining the constraint (generated code, vendored upstream, etc.)
and a TODO.

The sub-phase is complete when zero items remain unchecked in the
"complexity" sections of `violations.md`.

### Sub-phase 2.6 — Naming and style

- Rename files to `kebab-case.ts`.
- Strip `I` / `T` prefixes from interfaces and type aliases.
- Remove abbreviations from public symbols.
- Apply guide Section 12 style rules via lint autofix where possible;
  fix the remainder by hand.
- Commit: `refactor(style): naming and formatting pass`.

### Sub-phase 2.7 — Documentation

- Add TSDoc to every public export per guide Section 7.
- Mark internals with `@internal`.
- Add `@deprecated` with replacement pointers for anything slated for
  removal.
- Verify examples compile via `tsd`/`eslint-plugin-tsdoc` if
  installed.
- Commit: `docs(api): tsdoc for full public surface`.

### Sub-phase 2.8 — Build, exports, publish

- For every published package: set `"type": "module"`,
  `"sideEffects": false`, and a strict `"exports"` map (no
  wildcards).
- Confirm sourcemaps and declaration maps are emitted.
- Run `attw --pack` and `publint` per package; fix every warning.
- Commit: `build(pkg): esm-first exports map, attw clean`.

### Sub-phase 2.9 — Final verification

- Re-emit `.d.ts` for every barrel; diff against
  `.refactor/api-snapshot/`. The diff must be empty unless an item
  was approved in `breaking_changes.md`.
- Run the full test suite, type tests, lint, build, attw, publint,
  madge across every package.
- All must pass with zero warnings.

---

## Checkpoint Protocol (Run at Every Phase or Package Boundary)

After completing a sub-phase (or a package within a multi-package
sub-phase), and before stopping the session or beginning the next
chunk, run this protocol exactly:

1. **Verify locally.** Run `tsc -b`, `eslint`, and `vitest run` for
   the changed scope. Fix any regression *now*; never carry red into
   a checkpoint.
2. **Commit.** One conventional-commit per logical change. Never a
   single mega-commit per sub-phase.
3. **Update `.refactor/violations.md`.** Check off every item
   resolved.
4. **Update `.refactor/STATE.md`.** Reflect the sub-phase now
   completed, the next sub-phase to run, and which gates are green.
5. **Append to `.refactor/DECISIONS.md`** any judgment calls made
   during the sub-phase.
6. **Append to `.refactor/breaking_changes.md`** any public-surface
   changes that would break consumers (deferred until user
   approval).
7. **Rewrite `.refactor/HANDOFF.md`** for the next session: what to
   read first, what is mid-flight (ideally nothing), where to
   resume, and any gotchas. Keep it under one screen.
8. **Commit the state files** as a separate commit:
   `chore(refactor): checkpoint after sub-phase <N.M>`.
9. Decide: continue to next chunk, or end session. If ending, this
   is your last action — do not narrate further.

---

## Phase 3: Gate Conditions (All Must Pass to Finish)

The overall task is not complete until every one of these is true.
Verify by running each command and inspecting the result.

| Gate | Command                                       | Pass Criterion         |
| ---- | --------------------------------------------- | ---------------------- |
| G1   | `pnpm typecheck` (workspace)                  | 0 errors               |
| G2   | `pnpm lint`                                   | 0 errors, 0 warnings   |
| G3   | `pnpm test`                                   | All pass               |
| G4   | `madge --circular packages/*/src`             | 0 cycles per package   |
| G5   | `.d.ts` diff vs `.refactor/api-snapshot/`     | empty, OR every diff entry is in `breaking_changes.md` AND user-approved |
| G6   | No file in `packages/*/src/` exceeds 300 lines | Verify with `wc -l`   |
| G7   | No function exceeds 40 body lines             | ESLint `max-lines-per-function` clean |
| G8   | Cyclomatic complexity ≤ 10 everywhere         | ESLint `complexity` clean |
| G9   | Max function parameters ≤ 3                   | ESLint `max-params` clean |
| G10  | Every public export has TSDoc                 | `eslint-plugin-tsdoc` clean |
| G11  | `attw --pack` per published package           | 0 problems             |
| G12  | `publint` per published package               | 0 problems             |

If any gate fails, return to Phase 2, fix at the next session, and
re-run all gates. Do not report success while any gate is red.

Each session updates the "Gates passing/failing" lines in `STATE.md`
based on the latest run. The session that flips the last gate from
failing to passing proceeds directly to Phase 4 in the same session.

---

## Phase 4: Final Report (Only on the Final Session)

When and only when all 12 gates pass, produce a single concise report
with these sections:

1. **Summary.** One paragraph: scope, files touched across all
   sessions, gates passing.
2. **Public API changes.** Diff of every package's public surface. If
   any breaking changes were approved, justify each and confirm the
   CHANGELOG and version bump.
3. **Judgment calls.** Bulleted list (sourced from
   `.refactor/DECISIONS.md`) of every decision where the guide was
   silent or ambiguous, with one-line rationale.
4. **Deferred work.** Any items genuinely not refactorable under the
   limits, with the disable comment and a TODO ownership note.
5. **How to verify.** The 12 commands from the gate table, in order,
   for the user to run.
6. **Sessions consumed.** Total session count, with a one-line
   summary of each session's scope (drawn from commit history).

After the report, delete `.refactor/HANDOFF.md` (it has no purpose
once the task is complete) and commit:
`chore(refactor): finalize and clear handoff state`.

Do not include narration about what you did step-by-step. The git
history is the narration.

---

## Per-Session Status Output

Sessions that end at a checkpoint (i.e. not the final session) emit a
short status block to the user — *not* a full report. Format:

```
Session <N> complete.
- Sub-phase finished: <N.M> (<title>)
- Packages touched: <list or "all">
- Gates: <G1..G12 status one-liner>
- Commits this session: <count>
- Next sub-phase: <N.M+1> (<title>)
- Estimated sessions remaining: <rough count>
- Resume: re-run this prompt; the next session will read .refactor/STATE.md and continue.
```

That is the entire output. No narration of what was done — the diff
and commits speak for themselves.

---

## Anti-Patterns (Do Not Do These)

- ❌ "I've started the refactor. Should I continue with package X
  next?" → Just continue.
- ❌ "I noticed the codebase uses pattern Y. Want me to keep it or
  change it?" → The guide answers this. If it doesn't, decide and
  document in `DECISIONS.md`.
- ❌ "Sub-phase 2.3 is done, here's a summary of what I did." →
  Emit only the per-session status block.
- ❌ "I'll leave file Z for you to review." → No. The next session
  will pick it up if you have to stop.
- ❌ "This function is complex but necessary." → Then you haven't
  understood it. Re-read and decompose.
- ❌ "Tests are failing but the refactor is structurally complete."
  → Tests failing = checkpoint blocked. Fix them before stopping.
- ❌ Skipping a gate because it's "mostly" passing. → Gates are
  binary.
- ❌ Stopping mid-sub-phase or mid-file. → Always end at a sub-phase
  boundary (or a package boundary inside a sub-phase). If a chunk
  is too large, stop *before* starting it, not partway in.
- ❌ Re-investigating on resume. → `STATE.md` and `HANDOFF.md` are
  the contract. Trust them.
- ❌ Editing `.refactor/baseline.md` or `.refactor/api-snapshot/`
  after Phase 1. → They are the immutable reference points.
- ❌ Changing public API shape without recording it in
  `breaking_changes.md`. → Public surface is sacred.

---

## Begin

Read `TYPESCRIPT_SDK_GUIDE.md`, then check for `.refactor/STATE.md`.

- If it exists: read `STATE.md` and `HANDOFF.md`, then resume at the
  next unfinished sub-phase.
- If it does not: begin Phase 1 immediately.

Do not respond with a plan. Do not acknowledge this prompt. Your only
output is either:

- The per-session status block (if you stopped at a checkpoint), or
- The Phase 4 final report (if all gates passed in this session).
