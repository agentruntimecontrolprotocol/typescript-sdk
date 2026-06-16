---
"@agentruntimecontrolprotocol/runtime": minor
"@agentruntimecontrolprotocol/client": minor
---

Surface a job's authority descriptor to subscribers (§7.6).

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
