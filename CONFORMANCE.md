# ARCP v0.1 — Conformance to RFC 0001 v2

This document tracks the implementation status of every RFC section in the
TypeScript reference (`arcp` v0.1.0). Statuses:

- ✅ **Implemented** — full coverage, tested.
- 🟡 **Partial** — schemas in place; runtime path stubbed or limited.
- ⏳ **Deferred** — explicitly out-of-scope for v0.1, slated for v0.2+.

## Section status

| Section | Topic | Status | Notes |
|---|---|---|---|
| §1 Goals | Goals | n/a | Non-normative. |
| §2 Non-Goals | Non-Goals | n/a | Non-normative. |
| §3 Terminology | Terminology | ✅ | Names propagated to module/class names. |
| §4 Design Principles | Design Principles | ✅ | Authenticated-by-default enforced; no traffic before `session.accepted`. |
| §5 Architecture | Architecture | ✅ | Three-layer (capability/runtime/transport) split present. |
| §6.1 Envelope | Envelope shape | ✅ | All 18 fields modeled; ULID ids; round-trip preserved. |
| §6.2 Message Types | Type vocabulary | ✅ | All ~50 types in the discriminated union. Stubs return `UNIMPLEMENTED`. |
| §6.3 Command/Result/Event Flow | Ack-then-events / terminal events | ✅ | Tool/job lifecycle drives terminal events deterministically. |
| §6.4 Delivery Semantics | At-least-once + dedup | ✅ | Event log dedups by `(session_id, id)`. `idempotency_key` field present; (session_principal, idempotency_key) horizon persistence is **deferred**. |
| §6.5 Priority and QoS | Priority | 🟡 | Field accepted; runtime does not yet schedule by priority. |
| §7 Capability Negotiation | Negotiation | ✅ | AND of advertised booleans; min heartbeat interval wins. |
| §8.1 Session Establishment | Four-step handshake | ✅ | Direct-accept path implemented; challenge path unused but the schema exists. |
| §8.2 Credentials | bearer / signed_jwt / none / mtls / oauth2 | 🟡 | `bearer`, `signed_jwt`, `none` in scope. `mtls` and `oauth2` ⏳. |
| §8.3 Runtime Identity | Runtime identity in `session.accepted` | ✅ | |
| §8.4 Re-authentication | `session.refresh` | 🟡 | Schema accepted; refresh flow not driven by the runtime. |
| §8.5 Eviction | `session.evicted` | ✅ | Schema + reason taxonomy. |
| §9 Sessions | Stateless / stateful / durable | 🟡 | Stateless and stateful in scope. Durable across reconnects ⏳. |
| §10.1 Durable Jobs | Retries / heartbeats / cancellation | ✅ | Heartbeat watchdog with `N=2` missed-deadline policy. |
| §10.2 Job States | accepted/queued/running/blocked/paused/completed/failed/cancelled | ✅ | Full state machine. |
| §10.3 Heartbeats | Heartbeats | ✅ | Watchdog reset on heartbeat/progress; HEARTBEAT_LOST on miss. |
| §10.4 Cancellation | Cooperative + hard kill | ✅ | `deadline_ms` escalation to `ABORTED`. |
| §10.5 Interrupts | Interrupt → blocked + human.input.request | ✅ | |
| §10.6 Scheduled Jobs | `job.schedule` | ⏳ | Returns `UNIMPLEMENTED`. |
| §11.1 Stream Kinds | text/binary/event/log/metric/thought | ✅ | All kinds accepted; binary is base64 only. |
| §11.2 Backpressure | Backpressure | 🟡 | Advisory; `applyBackpressure` slows writes. No automatic shedding. |
| §11.3 Binary Encoding | base64 / sidecar | 🟡 | `base64` only. Sidecar frames ⏳. |
| §11.4 Reasoning Streams | thought streams | ✅ | `role`/`content`/`redacted` fields supported. |
| §12.1 Input Requests | `human.input.request` | ✅ | JSON-Schema-subset response validation. |
| §12.2 Choice Requests | `human.choice.request` | ✅ | Multi-option pickers. |
| §12.3 Provenance / Multi-Channel | First-response-wins | ✅ | Quorum policies ⏳. |
| §12.4 Expiration | `expires_at` | ✅ | Default fallback synthesized; otherwise `DEADLINE_EXCEEDED`. |
| §13.1 Subscribe | `subscribe` / `subscribe.accepted` | ✅ | |
| §13.2 Filtering | AND/OR semantics + authorization | ✅ | v0.1 entitles each session only to its own session_id. |
| §13.3 Backfill | `since` + boundary marker | ✅ | Synthetic `subscription.backfill_complete` emitted. |
| §13.4 Termination | `unsubscribe` / `subscribe.closed` | ✅ | |
| §14 Multi-Agent Coordination | `agent.delegate` / `agent.handoff` | ⏳ | Schemas accepted; runtime returns `UNIMPLEMENTED`. |
| §15.1 Permission Model | Explicit permissions | ✅ | |
| §15.2 Sandboxing | Sandboxing | n/a | Out of protocol scope; deployer concern. |
| §15.3 Trust Levels | untrusted/constrained/trusted/privileged | ✅ | Field accepted; not enforced by runtime. |
| §15.4 Permission Challenge | Challenge/grant/deny + lease | ✅ | |
| §15.5 Lease Lifecycle | Granted / refresh / extended / revoked | ✅ | LeaseManager with use-time validation. |
| §15.6 Trust Elevation | `trust.elevate.<level>` | ⏳ | |
| §16.1 Artifact References | `artifact.ref` | ✅ | |
| §16.2 Storage and Retrieval | put / fetch / release | ✅ | Inline base64 only. |
| §16.3 Lifecycle / Retention | Periodic sweep | ✅ | `setInterval(...).unref()`. |
| §17.1 Tracing | trace_id / span_id propagation | 🟡 | Fields propagate end-to-end; no `AsyncLocalStorage` autopopulation yet. |
| §17.2 Structured Logs | `log` envelope, six levels | ✅ | |
| §17.3 Metrics | `metric` envelope | ✅ | Reserved metric names with required units enforced. |
| §17.3.1 Standard Metric Names | Reserved names + units | ✅ | |
| §18.1 Error Envelope | Structured errors | ✅ | |
| §18.2 Canonical Error Codes | 21-code taxonomy | ✅ | All codes exported as a const tuple. |
| §18.3 Retryability and Backoff | Default retryability | ✅ | `isRetryableByDefault` mirrors §18.3. |
| §19 Resumability | Resume / replay | ✅ | Message-id resume only; checkpoint resume ⏳. |
| §20 MCP Compatibility | MCP wrapping | ⏳ | Not implemented. |
| §21.1 Naming | Extension namespacing | ✅ | Pattern enforced. |
| §21.2 Negotiation | Capability advertisement | ✅ | |
| §21.3 Unknown Message Handling | Drop optional / nack required | ✅ | |
| §21.4 Promotion to Core | Wire compatibility on promotion | n/a | Future-revision concern. |
| §22 Reference Transports | WebSocket / stdio | ✅ | Both implemented; HTTP/2 and QUIC ⏳. |
| §23 Example Lifecycle | Walkthrough | n/a | Non-normative. |
| §24 Example Invocation | Walkthrough | n/a | Non-normative. |
| §25 Real-World Examples | Examples | ✅ | Six examples in `examples/` mirror these flows in TypeScript. |
| §26 Future Work | Future work | n/a | Non-normative. |
| §27 Why ARCP Exists | Motivation | n/a | Non-normative. |
| §28 Reference Motto | — | n/a | |

## v0.2 candidates

- mTLS, OAuth2 auth schemes (§8.2).
- Sidecar binary stream frames over WebSocket (§11.3).
- Scheduled jobs (§10.6).
- Multi-agent delegation/handoff (§14).
- Trust elevation (§15.6).
- Checkpoint-based resume (§19).
- Quorum response policies for human input (§12.3).
- Browser builds and dual ESM/CJS publishing.
- HTTP/2 and QUIC transports.
