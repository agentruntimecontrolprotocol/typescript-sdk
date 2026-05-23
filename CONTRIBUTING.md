# Contributing to @agentruntimecontrolprotocol/sdk

Thanks for your interest in improving the TypeScript SDK for ARCP. This
document covers how to report issues, propose changes, and get a change merged.

Be respectful — assume good intent, keep critique focused on the work, and
flag conduct issues to the maintainers.

## Where changes belong

ARCP is two things in two places, and a change belongs to exactly one of them:

- **The protocol** — the wire format, message semantics, lease rules, error
  taxonomy, feature flags. These live in the
  [specification repository](https://github.com/agentruntimecontrolprotocol/spec).
  If your idea changes what goes *on the wire* or what a conformant runtime must
  do, it is a spec change — open it there, not here. This SDK implements the
  spec; it does not define it.
- **This SDK** — how the protocol is expressed idiomatically in TypeScript:
  bugs, ergonomics, performance, missing-but-specified features, docs, tests.
  Those belong here.

When in doubt, open an issue here and we'll redirect if it's really a protocol
question.

## The golden rule: conform, don't extend

A change to this SDK must keep it a faithful client of
[ARCP v1.1 (draft)](https://github.com/agentruntimecontrolprotocol/spec/blob/main/docs/draft-arcp-1.1.md).
Concretely:

- **Don't invent wire behavior.** No envelope fields, event kinds, error codes,
  or feature flags that the spec doesn't define. If you need one, it's a spec
  proposal first.
- **Negotiate honestly.** Only advertise a feature flag in `session.hello` once
  the SDK actually implements it. The feature matrix in the README must match
  what the code negotiates — a row marked `Supported` is a promise.
- **Respect the semantics.** Sequence numbers stay gap-free and monotonic;
  `LEASE_EXPIRED` and `BUDGET_EXHAUSTED` stay non-retryable; the effective
  feature set is the intersection of client and runtime advertisements. Tests
  must not paper over a semantic the spec requires.
- **Stay layered.** This SDK controls runtimes. It does not expose tools (that's
  MCP) or export telemetry (that's OpenTelemetry). PRs that blur those layers
  will be asked to move the logic out.

## Reporting bugs

Open an issue with: the SDK version and TypeScript version, the runtime you
connected to, a minimal reproduction (the smallest program that triggers it),
what you expected, and what happened. A failing test is the best possible bug
report. Wire-level traces (the envelopes exchanged) help enormously for protocol
behavior — redact any `auth.token` or provisioned-credential `value` first.

## Proposing a change

For anything beyond a small fix, open an issue describing the problem before
writing code, so we can agree on the approach. Small, focused PRs review faster
than large ones; if a change is big, say so early and we'll help break it down.

## Development setup

This repo is a pnpm workspace containing the `@agentruntimecontrolprotocol/*`
packages (`core`, `client`, `runtime`, `sdk`, and the `middleware/*` adapters).
You need Node.js `>= 22` and `pnpm` 9.15.0 (the version pinned via
`packageManager` in the root `package.json`; `corepack enable` will pick it up
automatically). Clone the repo, install once, and build all packages:

```sh
git clone https://github.com/agentruntimecontrolprotocol/typescript-sdk.git
cd typescript-sdk
corepack enable
pnpm install
pnpm build
```

A `simple-git-hooks` pre-commit hook runs Biome lint, `tsc`, and the test suite;
it is installed automatically on `pnpm install`.

## Tests and conformance

Two layers must pass before a PR merges:

- **Unit tests** — this SDK's own suite:

  ```sh
  pnpm test
  ```

- **Conformance** — the SDK's behavior against the reference runtime. New
  protocol-facing code (session negotiation, event sequencing, lease handling,
  error mapping) needs a test that exercises the real exchange, not a mock that
  assumes the answer. Because this SDK ships both `@agentruntimecontrolprotocol/client`
  and `@agentruntimecontrolprotocol/runtime` (it *is* the reference
  implementation), conformance tests run in-process by wiring the client to the
  runtime over the bundled `MemoryTransport`; the per-section spec mapping lives
  in [`CONFORMANCE.md`](CONFORMANCE.md), and the runnable end-to-end exchanges
  live under [`examples/`](examples/) and can be pointed at any conformant
  runtime via the `ARCP_DEMO_URL` / `ARCP_DEMO_TOKEN` environment variables.

CI runs both on every PR. A PR that changes which feature flags the SDK
negotiates must also update the README feature matrix in the same change.

## Coding standards

This repo uses Biome (lint + format on source), ESLint (import / TSDoc /
unicorn / n rules), Prettier (Markdown, JSON, YAML), and `tsc` for type
checking. Run them via the workspace scripts:

```sh
pnpm lint          # biome lint . && eslint .
pnpm lint:fix      # auto-fix biome + eslint findings
pnpm format        # prettier --write .
pnpm format:check  # prettier --check . (CI)
pnpm typecheck     # tsc --noEmit across every workspace package
pnpm check:all     # lint + typecheck + test + cycle / attw / publint checks
```

Match the surrounding code. Public API changes need doc comments and an entry in
the changelog. Prefer clarity over cleverness in a library others build on.

## Commit and pull-request conventions

- Write focused commits with present-tense, imperative subjects
  (`add result_chunk reassembly`, not `added` / `adds`).
- Reference the issue a PR closes (`Closes #123`).
- Keep the PR description honest about scope and any spec sections touched.
- Rebase on the default branch and ensure CI is green before requesting review.
- Sign off your commits to certify the [Developer Certificate of Origin](https://developercertificate.org/):

  ```sh
  git commit -s -m "your message"
  ```

- User-visible changes need a changeset. Run `pnpm changeset`, pick the affected
  packages and bump level, and commit the generated `.changeset/*.md` with your
  PR — the release workflow uses it to compute version bumps and changelogs.

## Releases

Releases are cut by maintainers. The workspace is managed with
[Changesets](https://github.com/changesets/changesets): merging changeset files
to `main` opens a "Version Packages" PR that bumps versions and writes
per-package `CHANGELOG.md` files, and merging that PR triggers the `publish`
workflow which publishes every changed `@agentruntimecontrolprotocol/*` package
to npm with provenance. The SDK is versioned with semantic versioning
independently of the protocol version it speaks; a protocol version bump is
noted in the changelog when the negotiated ARCP version changes.

## License

By contributing, you agree that your contributions are licensed under the
project's [Apache-2.0](LICENSE) license.
