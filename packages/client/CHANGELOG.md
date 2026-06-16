# @agentruntimecontrolprotocol/client

## 2.0.0

### Minor Changes

- 543b38b: Surface a job's authority descriptor to subscribers (§7.6).

  The runtime now populates `budget` (current per-currency counters) on
  `job.subscribed`, alongside the `lease_constraints` it already sent, so an
  observing principal can render a job's authority surface — the expiry clock
  and budget gauge — without being the job's submitter. The cap is derivable
  from the lease's `cost.budget` pattern; subsequent `cost.budget.remaining`
  metric events keep the gauge live.

  The client's `JobSubscription` now exposes the full descriptor:
  `currentStatus`, `agent`, `lease`, `leaseConstraints`, `budget`, and
  (submitter-only) `credentials`. Credentials remain redacted for non-submitters
  per §14. Backward-compatible — only additive fields.

## 1.0.0

### Minor Changes

- Publish the middleware packages (`@agentruntimecontrolprotocol/node`, `/express`, `/fastify`, `/hono`, `/bun`, `/middleware-otel`) to npm for the first time, and start mirroring every published package to GitHub Packages alongside npm. The publish workflow now walks `packages/middleware/*` so middleware manifests are no longer silently skipped.

### Patch Changes

- Updated dependencies
  - @agentruntimecontrolprotocol/core@1.0.0
