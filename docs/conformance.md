# Conformance

The TypeScript SDK is intended to be 100% conforming to ARCP v1.1.
Section-by-section status lives in
[`../CONFORMANCE.md`](../CONFORMANCE.md); this page is the docs mirror.

## v1.1 coverage

| Section                    | Status | Notes                                                              |
| -------------------------- | ------ | ------------------------------------------------------------------ |
| §4 Transport               | full   | WebSocket, stdio, in-memory.                                       |
| §5 Wire format             | full   | Envelope, `arcp: "1.1"`, ULID/UUIDv7 ids, `event_seq`, `trace_id`. |
| §6 Sessions                | full   | Hello, welcome, error, bye, resume.                                |
| §6.1 Authentication        | full   | Bearer + `StaticBearerVerifier`. Custom verifier interface.        |
| §6.2 Resume token rotation | full   | Single-use, rotated on every welcome.                              |
| §6.3 Resume                | full   | Window-bounded replay, gap-free.                                   |
| §6.4 Heartbeat             | full   | Negotiated via `heartbeat` feature flag.                           |
| §6.5 Ack                   | full   | Back-pressure; negotiated via `ack` feature flag.                  |
| §6.6 List jobs / Subscribe | full   | Negotiated via `list_jobs` and `subscribe` feature flags.          |
| §7 Jobs                    | full   | Submit, accepted, event, result, error, cancel.                    |
| §7.2 Idempotency           | full   | Configurable TTL.                                                  |
| §7.3 State machine         | full   | `pending → running → terminal`.                                    |
| §7.4 Cancellation          | full   | 30s grace by default.                                              |
| §7.5 Agent versions        | full   | Negotiated via `agent_versions` feature flag.                      |
| §7.6 Subscribe             | full   | Per-job cross-session subscription.                                |
| §8 Job events              | full   | All eight reserved kinds + `x-vendor.*`.                           |
| §8.2.1 Progress            | full   | Negotiated via `progress` feature flag.                            |
| §8.3 Sequence numbers      | full   | Session-scoped, strictly monotonic.                                |
| §8.4 Result chunks         | full   | Negotiated via `result_chunk` feature flag.                        |
| §9 Leases                  | full   | Immutable per-job, glob matching.                                  |
| §9.2 Glob syntax           | full   | `*` segment, `**` zero-or-more.                                    |
| §9.5 Lease expiry          | full   | Negotiated via `lease_expires_at` feature flag.                    |
| §9.6 Lease budgets         | full   | Negotiated via `cost.budget` feature flag; counters in `lease["cost.budget"]`. |
| §9.7 Model use             | full   | Negotiated via `model.use` feature flag.                           |
| §9.7–§9.8 Provisioned credentials | full | Negotiated via `provisioned_credentials` feature flag.            |
| §10 Delegation             | full   | Subset validation, trace inheritance.                              |
| §11 Trace propagation      | full   | W3C via `@agentruntimecontrolprotocol/middleware-otel`.            |
| §12 Error taxonomy         | full   | All 15 v1.1 codes implemented (see `ERROR_CODES`).                 |
| §14 Security               | full   | Resume sweep, per-session DoS caps, canonicalization.              |
| §15 Vendor extensions      | full   | Validation + round-trip.                                           |

## How conformance is tested

The SDK runs an integration suite in
[`packages/sdk/test/integration/`](../packages/sdk/test/integration/):

- `job-lifecycle.test.ts` — submit, accepted, events, terminal.
- `resume.test.ts` — disconnect + resume preserves order + content.
- `delegation.test.ts` — subset enforcement + trace inheritance.
- `idempotency.test.ts` — duplicate submits collapse.
- `transports.test.ts` — same behavior across WS / stdio / memory.
- `v1-1-features.test.ts` — coverage across the v1.1 surface.

All tests run on every commit via the package's own `pnpm test`
target.

## Reporting a deviation

If you find behavior that disagrees with the
[v1.1 spec](../../spec/docs/draft-arcp-1.1.md), open an issue with:

- Section number.
- Observed vs. expected behavior.
- Reproducer (minimum two-process script).

Tag with `conformance` and we'll triage.
