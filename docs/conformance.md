# Conformance

The TypeScript SDK is intended to be 100% conforming to ARCP v1.0
and includes opt-in v1.1 features. Section-by-section status lives
in [`../CONFORMANCE.md`](../CONFORMANCE.md); this page is the docs
mirror.

## v1.0 coverage

| Section | Status | Notes |
| --- | --- | --- |
| §4 Transport | full | WebSocket, stdio, in-memory. |
| §5 Wire format | full | Envelope, version `"1"`, ULID/UUIDv7 ids, `event_seq`, `trace_id`. |
| §6 Sessions | full | Hello, welcome, error, bye, resume. |
| §6.1 Authentication | full | Bearer + `StaticBearerVerifier`. Custom verifier interface. |
| §6.2 Resume token rotation | full | Single-use, rotated on every welcome. |
| §6.3 Resume | full | Window-bounded replay, gap-free. |
| §7 Jobs | full | Submit, accepted, event, result, error, cancel. |
| §7.2 Idempotency | full | Configurable TTL. |
| §7.3 State machine | full | `pending → running → terminal`. |
| §7.4 Cancellation | full | 30s grace by default. |
| §8 Job events | full | All eight reserved kinds + `x-vendor.*`. |
| §8.3 Sequence numbers | full | Session-scoped, strictly monotonic. |
| §9 Leases | full | Immutable per-job, glob matching. |
| §9.2 Glob syntax | full | `*` segment, `**` zero-or-more. |
| §10 Delegation | full | Subset validation, trace inheritance. |
| §11 Trace propagation | full | W3C via `@arcp/middleware-otel`. |
| §12 Error taxonomy | full | All 12 codes implemented. |
| §14 Security | full | Resume sweep, per-session DoS caps, canonicalization. |
| §15 Vendor extensions | full | Validation + round-trip. |

## v1.1 features

All v1.1 features are negotiated via `capabilities.features` and
default to on:

| Feature | Section | Status |
| --- | --- | --- |
| `heartbeat` | §6.4 | full |
| `ack` | §6.5 | full |
| `list_jobs` | §6.6 | full |
| `subscribe` | §6.6 / §7.6 | full |
| `agent_versions` | §7.5 | full |
| `lease_expires_at` | §9.5 | full |
| `lease_budgets` | §9.6 | full |
| `progress` | §8.2.1 | full |
| `result_chunk` | §8.4 | full |

Opt out of any feature with `features: [...]` on `ARCPClientOptions`
or `ARCPServerOptions`:

```ts
new ARCPServer({
  /* … */,
  features: ["heartbeat", "ack"], // drop the rest
});
```

## How conformance is tested

The SDK runs an integration suite in
[`packages/sdk/test/integration/`](../packages/sdk/test/integration/):

- `job-lifecycle.test.ts` — submit, accepted, events, terminal.
- `resume.test.ts` — disconnect + resume preserves order + content.
- `delegation.test.ts` — subset enforcement + trace inheritance.
- `idempotency.test.ts` — duplicate submits collapse.
- `transports.test.ts` — same behavior across WS / stdio / memory.
- `v1-1-features.test.ts` — 30 tests across the v1.1 surface.

All tests run on every commit via the package's own `pnpm test`
target.

## Reporting a deviation

If you find behavior that disagrees with the
[v1.0 spec](../../spec/docs/draft-arcp-02.md), open an issue with:

- Section number.
- Observed vs. expected behavior.
- Reproducer (minimum two-process script).

Tag with `conformance` and we'll triage.
