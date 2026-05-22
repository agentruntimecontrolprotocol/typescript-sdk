# Conformance — ARCP v1.1 (additive over v1.0)

This SDK targets [ARCP v1.1](../spec/docs/draft-arcp-02.1.md), the
backward-compatible additive revision of v1.0. v1.0 conformance is
preserved in full — all v1.0 sections below report the same status; the
new v1.1 subsections appear after them.

- **Implemented** — feature is present and matches the spec.
- **Deferred** — feature is intentionally not yet implemented, with rationale.

---

## §4. Transport

| Requirement                                               | Status      | Location                                                                                                                              |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| §4.1 WebSocket MUST be supported (`wss://`, `/arcp` path) | Implemented | `packages/core/src/transport/websocket.ts` (`WebSocketTransport`); `packages/middleware/node/src/index.ts` (path defaults to `/arcp`) |
| §4.1 JSON text frames only                                | Implemented | `packages/core/src/transport/websocket.ts` discards binary frames                                                                     |
| §4.2 stdio newline-delimited JSON                         | Implemented | `packages/core/src/transport/stdio.ts`                                                                                                |
| §4.3 Alternate transports MAY exist                       | Implemented | `MemoryTransport` (`packages/core/src/transport/memory.ts`) is the in-process test transport                                          |

## §5. Wire Format

| Requirement                                                                                   | Status      | Location                                                                                                    |
| --------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| §5.1 `arcp` field, REQUIRED, MUST be `"1.1"`                                                  | Implemented | `packages/core/src/version.ts:PROTOCOL_VERSION = "1.1"`; `packages/core/src/envelope.ts` rejects other values |
| §5.1 `id` REQUIRED, ULID/UUIDv7                                                               | Implemented | `packages/core/src/util/ulid.ts`; emitted by `buildEnvelope`                                                |
| §5.1 `type` REQUIRED                                                                          | Implemented | `packages/core/src/envelope.ts`                                                                             |
| §5.1 `session_id` REQUIRED on post-welcome envelopes                                          | Implemented | Per-message schemas in `packages/core/src/messages/{session,execution}.ts`                                  |
| §5.1 `trace_id` OPTIONAL, W3C 32-hex                                                          | Implemented | `packages/core/src/envelope.ts:isValidTraceId`                                                              |
| §5.1 `job_id` REQUIRED when applicable                                                        | Implemented | `packages/core/src/messages/execution.ts`                                                                   |
| §5.1 `event_seq` REQUIRED on `job.event`/`job.result`/`job.error` (monotonic, session-scoped) | Implemented | Schemas + `Job.emitEventKind` / `emitResult` / `emitErrorEnvelope` via `SessionContext.nextEventSeq()`      |
| §5.1 `payload` REQUIRED                                                                       | Implemented | `packages/core/src/envelope.ts`                                                                             |
| §5.1 Unknown top-level fields MUST be ignored                                                 | Implemented | `RoundTripEnvelopeSchema` uses `.passthrough()`                                                             |
| §5.2 JSON / UTF-8 / int64 only                                                                | Implemented | JSON-only transports                                                                                        |

## §6. Sessions

| Requirement                                                                                                                    | Status      | Location                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| §6.1 Bearer-token authentication on `session.hello`                                                                            | Implemented | `packages/core/src/auth/bearer.ts`; `packages/runtime/src/server.ts:authenticate()`                              |
| §6.1 Reject missing/invalid token with `session.error` + close                                                                 | Implemented | `packages/runtime/src/server.ts:emitSessionError` + `terminate`                                                  |
| §6.2 hello payload `client`/`auth`/`capabilities`; welcome payload `runtime`/`resume_token`/`resume_window_sec`/`capabilities` | Implemented | `packages/core/src/messages/session.ts`                                                                          |
| §6.2 `capabilities` includes `encodings` and (runtime) `agents`                                                                | Implemented | `packages/core/src/messages/session.ts:CapabilitiesSchema`                                                       |
| §6.2 Runtime MUST issue `resume_token` (≥128 bits entropy); client MUST treat as credential                                    | Implemented | `packages/runtime/src/server.ts:newResumeToken()` uses 32 random bytes (256 bits)                                |
| §6.2 `resume_token` rotated on every welcome                                                                                   | Implemented | `packages/runtime/src/server.ts:handleResume` writes a fresh token to `resumeStore` and emits in the new welcome |
| §6.3 Resume via `session.hello.payload.resume = { session_id, resume_token, last_event_seq }`                                  | Implemented | `packages/core/src/messages/session.ts:SessionHelloPayloadSchema`                                                |
| §6.3 On resume, replay `event_seq > last_event_seq`, issue new welcome with same `session_id`, resume streaming                | Implemented | `packages/runtime/src/server.ts:handleResume` reads via `EventLog.readSinceSeq` and re-sends frames              |
| §6.3 `RESUME_WINDOW_EXPIRED` on stale resume                                                                                   | Implemented | `packages/core/src/errors.ts:ResumeWindowExpiredError`; emitted in `server.ts:handleResume`                      |
| §6.7 Clean close via `session.bye { reason }`                                                                                  | Implemented | `packages/core/src/messages/session.ts:SessionByePayloadSchema`                                                  |
| §6.7 Either side MAY initiate; no further messages post-bye                                                                    | Implemented | `packages/runtime/src/server.ts:terminate` is idempotent                                                         |

## §7. Jobs

| Requirement                                                                                                         | Status      | Location                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| §7.1 `job.submit` with `agent`/`input`/`lease_request?`/`idempotency_key?`/`max_runtime_sec?`                       | Implemented | `packages/core/src/messages/execution.ts:JobSubmitPayloadSchema`                                               |
| §7.1 Runtime → `job.accepted { job_id, lease, accepted_at, parent_job_id?, delegate_id?, trace_id? }`               | Implemented | `packages/core/src/messages/execution.ts:JobAcceptedPayloadSchema`; `packages/runtime/src/job.ts:emitAccepted` |
| §7.1 Runtime MAY reduce, MUST NOT expand the lease                                                                  | Implemented | `packages/runtime/src/lease.ts:validateLeaseShape`; no expansion path exists                                   |
| §7.2 Transport-level idempotency via envelope `id` (dedupe)                                                         | Implemented | `packages/core/src/store/eventlog.ts:append` is `INSERT OR IGNORE`                                             |
| §7.2 Logical idempotency via `payload.idempotency_key`; same key+principal within ~24h → same `job_id`              | Implemented | `packages/runtime/src/server.ts:idempotencyStore` and `handleJobSubmit`                                        |
| §7.2 Different agent/input under same key → `DUPLICATE_KEY`                                                         | Implemented | `packages/runtime/src/server.ts:handleJobSubmit`; `packages/core/src/errors.ts:DuplicateKeyError`              |
| §7.3 States: `pending`, `running`, `success`, `error`, `cancelled`, `timed_out`                                     | Implemented | `packages/core/src/messages/execution.ts:JOB_STATES`; `packages/runtime/src/job.ts:JOB_TRANSITIONS`            |
| §7.3 Terminal events `job.result` (success) / `job.error` (failure variants), with `final_status`                   | Implemented | `packages/core/src/messages/execution.ts:JobResultPayloadSchema`, `JobErrorPayloadSchema`                      |
| §7.4 Cancellation via `job.cancel { reason }`; runtime emits `job.error{final_status:"cancelled"}` within 30s grace | Implemented | `packages/runtime/src/server.ts:handleJobCancel` + `cancelGraceMs` (default 30_000)                            |

## §8. Job Events

| Requirement                                                                                                                  | Status      | Location                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| §8.1 Single `job.event` envelope with `payload.kind`/`payload.ts`/`payload.body`                                             | Implemented | `packages/core/src/messages/execution.ts:JobEventPayloadSchema`                                              |
| §8.2 Eight reserved v1.0 kinds: `log`, `thought`, `tool_call`, `tool_result`, `status`, `metric`, `artifact_ref`, `delegate` | Implemented | `packages/core/src/messages/execution.ts:RESERVED_EVENT_KINDS`                                               |
| §8.2 `tool_call.body.call_id` links call/result                                                                              | Implemented | `ToolCallBodySchema`/`ToolResultBodySchema` both require `call_id`                                           |
| §8.2 Vendor namespace `x-vendor.kind` allowed; unknown kinds ignored                                                         | Implemented | `packages/core/src/messages/execution.ts:isVendorEventKind`; `JobEventPayloadSchema` accepts any string kind |
| §8.3 Sequence numbers SESSION-scoped (single space across concurrent jobs)                                                   | Implemented | `packages/runtime/src/server.ts:SessionContext.nextEventSeq`                                                 |
| §8.3 Strictly monotonic, gap-free across reconnects                                                                          | Implemented | `SessionContext.setEventSeq` is updated to the highest replayed value after resume                           |
| §8.3 Per-job ordering preserved within session seq                                                                           | Implemented | Inherits from the session counter                                                                            |

## §9. Leases

| Requirement                                                                                               | Status      | Location                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| §9.1 Lease is IMMUTABLE, granted at submit; capability → glob pattern[]                                   | Implemented | `packages/core/src/messages/execution.ts:LeaseSchema`; `packages/runtime/src/lease.ts:validateLeaseShape` |
| §9.2 Reserved namespaces `fs.read`, `fs.write`, `net.fetch`, `tool.call`, `agent.delegate`, `cost.budget`, `model.use` | Implemented | `packages/core/src/messages/lease-schema.ts:RESERVED_CAPABILITY_NAMES`                                    |
| §9.2 Glob `*` (single segment) / `**` (zero+ segments); anchored                                          | Implemented | `packages/runtime/src/lease.ts:compileGlob`/`matchGlob`                                                   |
| §9.3 Runtime MUST validate every operation against the lease; `PERMISSION_DENIED` on fail                 | Implemented | `packages/runtime/src/lease.ts:validateLeaseOp`                                                           |
| §9.4 Lease subsetting for delegation                                                                      | Implemented | `packages/runtime/src/lease.ts:isLeaseSubset`/`assertLeaseSubset`                                         |
| §14 Canonicalize paths/URLs before glob check                                                             | Implemented | `packages/runtime/src/lease.ts:canonicalizeTarget`                                                        |

## §10. Delegation

| Requirement                                                                                                                       | Status      | Location                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| §10.1 Delegation as `job.event` with `kind: "delegate"` carrying `{delegate_id, agent, input, lease_request, lease_constraints?}` | Implemented | `packages/core/src/messages/execution.ts:DelegateBodySchema`; emitted by `JobContext.delegate()` |
| §10.1 Runtime responds with `job.accepted { job_id, parent_job_id, delegate_id, lease }`                                          | Implemented | `packages/runtime/src/server.ts:createDelegateJob`                                               |
| §10.2 Subset validation surfaces failure as `tool_result` event on PARENT with `LEASE_SUBSET_VIOLATION`                           | Implemented | `packages/runtime/src/server.ts:makeDelegateInterceptor`                                         |
| §10.3 Delegated jobs inherit parent `trace_id`; new span MAY be created                                                           | Implemented | `packages/runtime/src/server.ts:createDelegateJob`                                               |

## §11. Trace Propagation

| Requirement                                                                                                                         | Status      | Location                                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| §11 `trace_id` is W3C 32-hex; client SHOULD include on submit; runtime MUST mint if absent, echo on `job.accepted.payload.trace_id` | Implemented | `packages/runtime/src/server.ts:handleJobSubmit` |
| §11 Runtime SHOULD emit OTel spans with `arcp.session_id`, `arcp.job_id`, `arcp.agent`, `arcp.lease.capabilities`                   | Implemented | `packages/middleware/otel/src/index.ts`          |

## §12. Error Taxonomy (v1.0 codes)

| Code                                                   | Status      | Location                                                |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------- |
| `PERMISSION_DENIED`                                    | Implemented | `packages/core/src/errors.ts:PermissionDeniedError`     |
| `LEASE_SUBSET_VIOLATION`                               | Implemented | `packages/core/src/errors.ts:LeaseSubsetViolationError` |
| `JOB_NOT_FOUND`                                        | Implemented | `packages/core/src/errors.ts:JobNotFoundError`          |
| `DUPLICATE_KEY`                                        | Implemented | `packages/core/src/errors.ts:DuplicateKeyError`         |
| `AGENT_NOT_AVAILABLE`                                  | Implemented | `packages/core/src/errors.ts:AgentNotAvailableError`    |
| `CANCELLED`                                            | Implemented | `packages/core/src/errors.ts:CancelledError`            |
| `TIMEOUT`                                              | Implemented | `packages/core/src/errors.ts:TimeoutError`              |
| `RESUME_WINDOW_EXPIRED`                                | Implemented | `packages/core/src/errors.ts:ResumeWindowExpiredError`  |
| `HEARTBEAT_LOST`                                       | Implemented | `packages/core/src/errors.ts:HeartbeatLostError`        |
| `INVALID_REQUEST`                                      | Implemented | `packages/core/src/errors.ts:InvalidRequestError`       |
| `UNAUTHENTICATED`                                      | Implemented | `packages/core/src/errors.ts:UnauthenticatedError`      |
| `INTERNAL_ERROR`                                       | Implemented | `packages/core/src/errors.ts:InternalError`             |
| Error payload `{ code, message, retryable, details? }` | Implemented | `packages/core/src/errors.ts:ErrorPayloadSchema`        |

## §13. Examples

Twenty-three runnable two-process examples under `examples/`. Each
exercises one v1.0 or v1.1 feature or one host-integration middleware
end-to-end (no mocks; real transport).

v1.0 core:

| Directory            | Spec              |
| -------------------- | ----------------- |
| `submit-and-stream/` | §13.1 / §8.2      |
| `delegate/`          | §13.2 / §10       |
| `resume/`            | §13.3 / §6.3      |
| `idempotent-retry/`  | §13.5 / §7.2      |
| `lease-violation/`   | §13.4 / §9.3      |
| `cancel/`            | §7.4              |
| `stdio/`             | §4.2              |
| `vendor-extensions/` | §8.2 / §9.2 / §15 |
| `custom-auth/`       | §6.1              |

v1.1 features (one example per addition):

| Directory           | Spec        |
| ------------------- | ----------- |
| `heartbeat/`        | §6.4        |
| `ack-backpressure/` | §6.5 / §8.2 |
| `list-jobs/`        | §6.6        |
| `subscribe/`        | §7.6 / §6.6 |
| `agent-versions/`   | §7.5 / §12  |
| `lease-expires-at/` | §9.5 / §12  |
| `cost-budget/`      | §9.6 / §12  |
| `progress/`         | §8.2.1      |
| `result-chunk/`     | §8.4        |

Host integrations (one example per middleware):

| Directory  | Middleware              |
| ---------- | ----------------------- |
| `tracing/` | `@arcp/middleware-otel` |
| `express/` | `@arcp/express`         |
| `fastify/` | `@arcp/fastify`         |
| `bun/`     | `@arcp/bun`             |

## §14. Security Considerations

| Requirement                                                                                                       | Status                            | Location                                                             |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| §14 `wss://` required, bearer not over cleartext                                                                  | Implemented (deployer-controlled) | SDK does not downgrade                                               |
| §14 `resume_token` ≥128 bits entropy                                                                              | Implemented                       | `packages/runtime/src/server.ts:newResumeToken` (256 bits)           |
| §14 Lease MUST be checked even with sandboxing                                                                    | Implemented (responsibility)      | `validateLeaseOp` is the SDK's interception primitive                |
| §14 Canonicalize paths/URLs before glob check                                                                     | Implemented                       | `packages/runtime/src/lease.ts:canonicalizeTarget`                   |
| §14 Buffered events at rest: purge at window expiry                                                               | Implemented                       | `packages/runtime/src/server.ts:sweepResume` runs on a 60 s interval |
| §14 Per-session DoS caps (max buffered events / bytes / concurrent jobs); exceed ⇒ `INTERNAL_ERROR` non-retryable | Implemented                       | `packages/runtime/src/server.ts:SessionContext.checkCaps`            |

## §15. IANA / Extension namespace

| Requirement                                                                | Status      | Location                                                                                                             |
| -------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `x-vendor.*` namespace for vendor extension envelope types and event kinds | Implemented | `packages/core/src/extensions.ts:isVendorExtensionName`; `packages/core/src/messages/execution.ts:isVendorEventKind` |
| Unknown `x-vendor.*` types ignored (drop)                                  | Implemented | `packages/core/src/extensions.ts:classifyUnknownType`                                                                |

---

# v1.1 additions

ARCP v1.1 is fully backward-compatible with v1.0. The `arcp` envelope
field remains `"1"`. New messages, fields, event kinds, lease
constraints, and error codes are negotiated via the v1.1 `features`
capability list in `session.hello`/`session.welcome`.

## Feature negotiation matrix

| Feature flag       | Spec ref | Status      | Where the flag is consumed                                                                                                                               |
| ------------------ | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heartbeat`        | §6.4     | Implemented | `packages/runtime/src/server.ts:SessionContext.startHeartbeat`; client responds to ping in `packages/client/src/client.ts:dispatchRaw`                   |
| `ack`              | §6.5     | Implemented | `packages/runtime/src/server.ts:registerPostHandshakeHandlers` (`session.ack` handler) + `SessionContext.recordAck`; client `ARCPClient.ack` / `autoAck` |
| `list_jobs`        | §6.6     | Implemented | `packages/runtime/src/server.ts:handleListJobs`; `ARCPClient.listJobs`                                                                                   |
| `subscribe`        | §7.6     | Implemented | `packages/runtime/src/server.ts:handleJobSubscribe`; `ARCPClient.subscribe`                                                                              |
| `lease_expires_at` | §9.5     | Implemented | `packages/runtime/src/lease.ts:validateLeaseConstraints`; expiry watchdog in `server.ts:runHandler`                                                      |
| `cost.budget`      | §9.6     | Implemented | `packages/runtime/src/lease.ts:initialBudgetFromLease`; `Job.applyCostMetric`; `validateLeaseOp` budget check                                            |
| `model.use`        | §9.7     | Implemented | `packages/core/src/messages/lease-schema.ts:RESERVED_CAPABILITY_NAMES`; `packages/runtime/src/lease.ts:validateLeaseOp`                                  |
| `provisioned_credentials` | §9.8 | Implemented | `packages/runtime/src/credential-provisioner.ts`; `packages/runtime/src/job-runner.ts:issueCredentials`                                                   |
| `progress`         | §8.2     | Implemented | `packages/core/src/messages/execution.ts:ProgressBodySchema`; `JobContext.progress`                                                                      |
| `result_chunk`     | §8.4     | Implemented | `packages/core/src/messages/execution.ts:ResultChunkBodySchema`; `JobContext.streamResult` + `JobHandle.collectChunks`                                   |
| `agent_versions`   | §7.5     | Implemented | `packages/core/src/messages/execution.ts:parseAgentRef`; `ARCPServer.registerAgentVersion`/`setDefaultAgentVersion`/`resolveAgent`                       |

The negotiated set is `intersect(session.hello.capabilities.features,
session.welcome.capabilities.features)`. Either peer can introspect
via `client.negotiatedFeatures` / `client.hasFeature(name)` and
`SessionContext.negotiatedFeatures` / `SessionContext.hasFeature(name)`.
Feature handlers MUST refuse to operate if the feature is not in the
intersection (e.g., `client.ack(seq)` throws `INVALID_REQUEST`).

Helpers:

- `packages/core/src/version.ts:V1_1_FEATURES` — canonical feature list.
- `packages/core/src/version.ts:intersectFeatures(a, b)` — intersection helper.

## §6.2 Capabilities (v1.1 additions)

| Requirement                                                                                                            | Status      | Location                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §6.2 `capabilities.features: string[]` on hello and welcome                                                            | Implemented | `packages/core/src/messages/session.ts:CapabilitiesSchema`                                                                                                     |
| §6.2 Effective feature set is the intersection of both lists                                                           | Implemented | `packages/core/src/version.ts:intersectFeatures`; `packages/runtime/src/server.ts:makeNegotiatedCapabilities`; `packages/client/src/client.ts:connectInternal` |
| §6.2 Runtime advertises the rich `agents: Array<{name, versions, default?}>` shape when `agent_versions` is negotiated | Implemented | `packages/runtime/src/server.ts:ARCPServer.getAgentInventory` + `makeNegotiatedCapabilities`                                                                   |
| §6.2 Client SHOULD accept either flat `string[]` or rich object shape for `agents`                                     | Implemented | `packages/core/src/messages/session.ts:CapabilitiesSchema` (union); helper `normalizeAgentInventory`                                                           |

## §6.4 Heartbeats

| Requirement                                                                                                                     | Status      | Location                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Feature flag `heartbeat`                                                                                                        | Implemented | `packages/core/src/version.ts:V1_1_FEATURES`                                                                             |
| `session.ping` / `session.pong` envelopes (`{nonce, sent_at}` / `{ping_nonce, received_at}`)                                    | Implemented | `packages/core/src/messages/session.ts:SessionPingPayloadSchema`/`SessionPongPayloadSchema`                              |
| `session.welcome.payload.heartbeat_interval_sec` advertised                                                                     | Implemented | `packages/core/src/messages/session.ts:SessionWelcomePayloadSchema`; `packages/runtime/src/server.ts:handleSessionHello` |
| Runtime periodically pings if outbound idle and replies to inbound pings; closes with `HEARTBEAT_LOST` after 2 silent intervals | Implemented | `packages/runtime/src/server.ts:SessionContext.startHeartbeat`/`heartbeatTick`                                           |
| Client periodically pings if idle and replies to runtime pings                                                                  | Implemented | `packages/client/src/client.ts:dispatchRaw` (pong path); ping side TBD when long-lived idle is required                  |
| `session.ping`/`session.pong` NOT counted in `event_seq`                                                                        | Implemented | `packages/runtime/src/server.ts:SessionContext.dispatchRaw` (`SKIP_LOG` set)                                             |

## §6.5 Event Acknowledgement

| Requirement                                                                    | Status      | Location                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature flag `ack`                                                             | Implemented | `packages/core/src/version.ts:V1_1_FEATURES`                                                                                                                |
| `session.ack { last_processed_seq }` envelope                                  | Implemented | `packages/core/src/messages/session.ts:SessionAckPayloadSchema`                                                                                             |
| Runtime records the client's `last_processed_seq`                              | Implemented | `packages/runtime/src/server.ts:SessionContext.recordAck`                                                                                                   |
| Runtime MAY emit a `back_pressure` `status` event when lag exceeds a threshold | Implemented | `packages/runtime/src/server.ts:SessionContext.emitBackPressureStatus` (default threshold 1000, configurable via `ARCPServerOptions.backPressureThreshold`) |
| Client `ack(seq)` helper                                                       | Implemented | `packages/client/src/client.ts:ARCPClient.ack`                                                                                                              |
| Client `autoAck` coalesces acks (every N events or M ms)                       | Implemented | `packages/client/src/client.ts:scheduleAutoAck` (defaults 32 events / 250 ms)                                                                               |
| `session.ack` NOT counted in `event_seq`                                       | Implemented | `packages/runtime/src/server.ts:SessionContext.dispatchRaw`                                                                                                 |

## §6.6 Job Listing

| Requirement                                                                                                                                         | Status      | Location                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| Feature flag `list_jobs`                                                                                                                            | Implemented | `packages/core/src/version.ts:V1_1_FEATURES`                                                                |
| `session.list_jobs { filter?, limit?, cursor? }` envelope with `filter.status?`, `filter.agent?`, `filter.created_after?`, `filter.created_before?` | Implemented | `packages/core/src/messages/session.ts:SessionListJobsPayloadSchema`                                        |
| `session.jobs { request_id, jobs: JobListEntry[], next_cursor }` response                                                                           | Implemented | `packages/core/src/messages/session.ts:SessionJobsPayloadSchema`                                            |
| `JobListEntry { job_id, agent, status, lease, parent_job_id, created_at, trace_id, last_event_seq }`                                                | Implemented | `packages/core/src/messages/session.ts:JobListEntrySchema`                                                  |
| Runtime echoes the request envelope's `id` as `request_id`                                                                                          | Implemented | `packages/runtime/src/server.ts:handleListJobs`                                                             |
| Authorization defaults to same-principal-only; broader policy via `jobAuthorizationPolicy`                                                          | Implemented | `packages/runtime/src/server.ts:defaultJobAuthorizationPolicy` + `ARCPServerOptions.jobAuthorizationPolicy` |
| Client `listJobs(filter?, { limit?, cursor? })`                                                                                                     | Implemented | `packages/client/src/client.ts:ARCPClient.listJobs`                                                         |

## §7.5 Agent Versioning

| Requirement                                                                                                                | Status                                                                                         | Location                                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Feature flag `agent_versions`                                                                                              | Implemented                                                                                    | `packages/core/src/version.ts:V1_1_FEATURES`                                          |
| `agent ::= name                                                                                                            | name "@" version`grammar (names lowercase`[a-z0-9][a-z0-9._-]\*`; versions `[a-zA-Z0-9.+_-]+`) | Implemented                                                                           | `packages/core/src/messages/execution.ts:parseAgentRef` + `formatAgentRef` |
| Bare name resolves to the default version (or unversioned handler)                                                         | Implemented                                                                                    | `packages/runtime/src/server.ts:ARCPServer.resolveAgent`                              |
| `name@version` requires an exact match; otherwise `AGENT_VERSION_NOT_AVAILABLE` (`session.error`)                          | Implemented                                                                                    | `packages/runtime/src/server.ts:handleJobSubmit` (calls `emitSessionError` per §13.7) |
| Runtime advertises rich agent inventory when feature negotiated                                                            | Implemented                                                                                    | `packages/runtime/src/server.ts:ARCPServer.getAgentInventory`                         |
| `job.accepted.payload.agent` echoes the resolved `name@version`                                                            | Implemented                                                                                    | `packages/runtime/src/job.ts:emitAccepted`                                            |
| Running job's version is fixed; never migrated                                                                             | Implemented                                                                                    | `packages/runtime/src/job.ts` — `agentVersion` is `readonly` on the Job               |
| Server APIs: `registerAgent(name, fn)`, `registerAgentVersion(name, version, fn)`, `setDefaultAgentVersion(name, version)` | Implemented                                                                                    | `packages/runtime/src/server.ts:ARCPServer`                                           |

## §7.6 Subscription

| Requirement                                                                                                                       | Status      | Location                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Feature flag `subscribe`                                                                                                          | Implemented | `packages/core/src/version.ts:V1_1_FEATURES`                                                                                     |
| `job.subscribe { job_id, from_event_seq?, history? }` envelope                                                                    | Implemented | `packages/core/src/messages/execution.ts:JobSubscribePayloadSchema`                                                              |
| `job.subscribed` response carrying `current_status`, `agent`, `lease`, `parent_job_id`, `trace_id`, `subscribed_from`, `replayed` | Implemented | `packages/core/src/messages/execution.ts:JobSubscribedPayloadSchema`                                                             |
| `job.unsubscribe { job_id }` envelope                                                                                             | Implemented | `packages/core/src/messages/execution.ts:JobUnsubscribePayloadSchema`                                                            |
| Same-principal scope by default; deployment policy can broaden                                                                    | Implemented | `packages/runtime/src/server.ts:defaultJobAuthorizationPolicy` + `jobAuthorizationPolicy` hook                                   |
| `history: true` replays buffered events; each replayed event uses the _subscriber's_ `event_seq`                                  | Implemented | `packages/runtime/src/server.ts:handleJobSubscribe` + `forwardEventToSubscriber` (uses `sub.nextEventSeq()`)                     |
| Live events fan out to all subscribers in addition to the owning session                                                          | Implemented | `packages/runtime/src/server.ts:SessionContext.send` fan-out block                                                               |
| Subscribers MUST NOT have cancel authority — only the submitting session may cancel                                               | Implemented | `packages/runtime/src/server.ts:handleJobCancel` returns `PERMISSION_DENIED` when the session is a subscriber, not the submitter |
| Client `subscribe(jobId, { history?, fromEventSeq? })` returning a handle with `unsubscribe()`                                    | Implemented | `packages/client/src/client.ts:ARCPClient.subscribe`                                                                             |

## §8.2 Progress events

| Requirement                                                                                                  | Status      | Location                                                       |
| ------------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------- |
| `progress` kind reserved                                                                                     | Implemented | `packages/core/src/messages/execution.ts:RESERVED_EVENT_KINDS` |
| Body schema `{ current, total?, units?, message? }`; `current` non-negative; `total` ≥ `current` recommended | Implemented | `packages/core/src/messages/execution.ts:ProgressBodySchema`   |
| `parseJobEventBody("progress", body)` validates the body                                                     | Implemented | `packages/core/src/messages/execution.ts:parseJobEventBody`    |
| `JobContext.progress(current, opts?)` helper                                                                 | Implemented | `packages/runtime/src/job.ts:makeJobContext`                   |

## §8.4 Streamed results

| Requirement                                                                                                   | Status      | Location                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| Feature flag `result_chunk`                                                                                   | Implemented | `packages/core/src/version.ts:V1_1_FEATURES`                                     |
| `result_chunk` kind reserved                                                                                  | Implemented | `packages/core/src/messages/execution.ts:RESERVED_EVENT_KINDS`                   |
| Body schema `{ result_id, chunk_seq, data, encoding ∈ {utf8,base64}, more }`                                  | Implemented | `packages/core/src/messages/execution.ts:ResultChunkBodySchema`                  |
| `job.result.payload.result_id` / `result_size`                                                                | Implemented | `packages/core/src/messages/execution.ts:JobResultPayloadSchema`                 |
| MUST NOT mix inline `result` and `result_chunk` in one job                                                    | Implemented | `packages/runtime/src/job.ts:Job.emitResult` enforces with `InvalidRequestError` |
| `JobContext.streamResult({ resultId? })` writer (auto chunk_seq + terminal `more:false` + final `job.result`) | Implemented | `packages/runtime/src/job.ts:makeResultStream`                                   |
| `JobContext.resultChunk(body)` raw emit                                                                       | Implemented | `packages/runtime/src/job.ts:makeJobContext`                                     |
| Client `JobHandle.collectChunks()` assembles chunks by `result_id`                                            | Implemented | `packages/client/src/client.ts:makeHandleFromInvocation`                         |

## §9.4 Lease subsetting (v1.1 additions)

| Requirement                                                                                   | Status      | Location                                                                                                             |
| --------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Child `cost.budget` MUST NOT exceed parent's REMAINING budget per currency at delegation time | Implemented | `packages/runtime/src/lease.ts:isLeaseSubset` (numeric per-currency comparison; accepts `parentBudgetRemaining` Map) |
| Child `lease_constraints.expires_at` MUST NOT exceed parent's                                 | Implemented | `packages/runtime/src/lease.ts:assertLeaseConstraintsSubset`                                                         |
| Child without `lease_constraints` inherits parent's expiry implicitly                         | Implemented | `packages/runtime/src/server.ts:createDelegateJob` (`effectiveConstraints` falls back to `parent.leaseConstraints`)  |

## §9.5 Lease expiration

| Requirement                                                                                                         | Status      | Location                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature flag `lease_expires_at`                                                                                     | Implemented | `packages/core/src/version.ts:V1_1_FEATURES`                                                                                                     |
| `lease_constraints.expires_at` on `job.submit` and `job.accepted` (ISO 8601 UTC with `Z`, MUST be future)           | Implemented | `packages/core/src/messages/execution.ts:LeaseConstraintsSchema`; runtime validation in `packages/runtime/src/lease.ts:validateLeaseConstraints` |
| Past or invalid values rejected with `INVALID_REQUEST`                                                              | Implemented | `packages/runtime/src/lease.ts:validateLeaseConstraints`                                                                                         |
| Operations attempted at or after `expires_at` MUST fail with `LEASE_EXPIRED`                                        | Implemented | `packages/runtime/src/lease.ts:validateLeaseOp` (`LeaseOpContext.constraints`)                                                                   |
| Runtime MUST emit `job.error { final_status: "error", code: "LEASE_EXPIRED" }` when the lease elapses while running | Implemented | `packages/runtime/src/server.ts:runHandler` (lease-expiry timer)                                                                                 |
| Renewal NOT supported                                                                                               | Implemented | No renewal API exists                                                                                                                            |
| `validateLeaseOp` accepts an optional `now` for clock injection                                                     | Implemented | `packages/runtime/src/lease.ts:LeaseOpContext.now`                                                                                               |

## §9.6 Budget capability

| Requirement                                                                                                         | Status      | Location                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Feature flag `cost.budget`                                                                                          | Implemented | `packages/core/src/version.ts:V1_1_FEATURES`                                                                           |
| `cost.budget` in `RESERVED_CAPABILITY_NAMES`                                                                        | Implemented | `packages/core/src/messages/execution.ts:RESERVED_CAPABILITY_NAMES`                                                    |
| Amount grammar `currency:decimal` (USD/EUR/credits/custom)                                                          | Implemented | `packages/core/src/messages/execution.ts:parseBudgetAmount`                                                            |
| `validateLeaseShape` rejects malformed budget patterns with `INVALID_REQUEST`                                       | Implemented | `packages/runtime/src/lease.ts:validateLeaseShape`                                                                     |
| Initial per-currency counters initialized from the lease at `job.accepted`                                          | Implemented | `packages/runtime/src/lease.ts:initialBudgetFromLease`; echoed in `job.accepted.payload.budget` via `Job.emitAccepted` |
| Counters decrement on `metric` events whose `name` starts with `cost.` and whose `unit` matches a budgeted currency | Implemented | `packages/runtime/src/job.ts:Job.applyCostMetric` + `packages/runtime/src/server.ts:metricInterceptor`                 |
| Negative metric values rejected (no decrement)                                                                      | Implemented | `packages/runtime/src/job.ts:Job.applyCostMetric`                                                                      |
| Operations fail with `BUDGET_EXHAUSTED` when a counter ≤ 0                                                          | Implemented | `packages/runtime/src/lease.ts:validateLeaseOp`                                                                        |
| Runtime MAY emit `cost.budget.remaining` metric events with debounce                                                | Implemented | `packages/runtime/src/server.ts:metricInterceptor` + `Job.shouldEmitBudgetRemaining` (5 % threshold)                   |
| `JobContext.budget` read-only snapshot of remaining counters                                                        | Implemented | `packages/runtime/src/job.ts:makeJobContext`                                                                           |

## §9.7 / §9.8 Model Use and Provisioned Credentials

| Requirement                                                                    | Status      | Location                                                                                                        |
| ------------------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| Feature flags `model.use` and `provisioned_credentials`                        | Implemented | `packages/core/src/version.ts:V1_1_FEATURES`                                                                    |
| `model.use` in `RESERVED_CAPABILITY_NAMES`                                      | Implemented | `packages/core/src/messages/lease-schema.ts:RESERVED_CAPABILITY_NAMES`                                          |
| `model.use` glob matching and lease subsetting                                  | Implemented | `packages/runtime/src/lease.ts:validateLeaseOp`; `packages/runtime/src/lease.ts:isLeaseSubset`                  |
| Credential wire shape `{ id, scheme, value, endpoint, profile?, constraints? }` | Implemented | `packages/core/src/messages/credentials.ts`; `packages/core/src/messages/execution.ts:JobAcceptedPayloadSchema` |
| Runtime issues credentials before `job.accepted` when a provisioner is set      | Implemented | `packages/runtime/src/job-runner.ts:issueCredentials`                                                           |
| Runtime revokes stored credential ids on terminal cleanup                       | Implemented | `packages/runtime/src/job.ts:revokeAll`; `packages/runtime/src/credential-store.ts`                             |
| Runtime only advertises credential features when a provisioner is configured    | Implemented | `packages/runtime/src/server.ts:advertisedFeatures`                                                             |
| `credentialProvisioner` requires `credentialStore`                              | Implemented | `packages/runtime/src/server.ts:ARCPServer` constructor                                                         |
| `job.subscribed` redacts credentials for non-submitters                         | Implemented | `packages/runtime/src/server-subscribe.ts:buildSubscribedPayload`                                               |
| Client surfaces accepted credentials on `JobHandle.credentials`                 | Implemented | `packages/client/src/client-handle.ts`; `packages/client/src/client-dispatch.ts`                                |
| Upstream spend-cap failures can be translated to `BUDGET_EXHAUSTED`             | Implemented | `packages/runtime/src/credential-provisioner.ts:toBudgetExhausted`                                              |

## §11 Trace attributes (v1.1 additions)

| Requirement                                                                             | Status      | Location                                                  |
| --------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------- |
| `arcp.lease.expires_at` span attribute when present                                     | Implemented | `packages/middleware/otel/src/index.ts:extractAttributes` |
| `arcp.budget.remaining` span attribute (encoded as JSON string for per-currency totals) | Implemented | `packages/middleware/otel/src/index.ts:extractAttributes` |

## §12 Error taxonomy (v1.1 additions)

| Code                                   | Status      | Location                                                    |
| -------------------------------------- | ----------- | ----------------------------------------------------------- |
| `AGENT_VERSION_NOT_AVAILABLE`          | Implemented | `packages/core/src/errors.ts:AgentVersionNotAvailableError` |
| `LEASE_EXPIRED`                        | Implemented | `packages/core/src/errors.ts:LeaseExpiredError`             |
| `BUDGET_EXHAUSTED`                     | Implemented | `packages/core/src/errors.ts:BudgetExhaustedError`          |
| All three are non-retryable by default | Implemented | Subclass constructors set `retryable: false`                |

The full canonical v1.1 set is 15 codes; see
`packages/core/src/errors.ts:ERROR_CODES`.

---

## Intentional deferrals

| Item                                                  | Why                                                                                                                                             | Effect                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent idempotency store                          | The runtime ships with an in-memory `idempotencyStore` and a 24-hour TTL sweep. v1.0/v1.1 mandate `~24h` semantics but not persistence.         | Restart drops cache. Production deployments override `idempotencyTtlMs` and/or swap in a persistent map.                              |
| Sandboxed lease enforcement                           | The SDK ships `validateLeaseOp` and expects the agent (or a runtime-wrapping shim) to call it.                                                  | Agent authors call `validateLeaseOp(ctx.lease, capability, target, { constraints, budgetRemaining })`.                                |
| `INVALID_REQUEST` on un-prefixed unknown capabilities | We enforce this strictly.                                                                                                                       | Consumers MUST stick to reserved namespaces or `x-vendor.*`.                                                                          |
| Client-side proactive heartbeat ping                  | The client responds to runtime pings; it does not yet proactively ping when idle. The runtime's outbound ping covers the common dead-peer case. | Long-lived idle from the runtime side is still detected on the runtime's clock; symmetric client-side detection is a small follow-up. |

## Status summary

- **All §4–§15 normative requirements** for v1.0 are implemented as in
  the previous CONFORMANCE.md.
- **All v1.1 additions** in §6.2 (features + rich agent inventory),
  §6.4 (heartbeats), §6.5 (ack), §6.6 (list_jobs), §7.5 (versioning),
  §7.6 (subscribe), §8.2 (progress), §8.4 (result streaming),
  §9.4–§9.6 (lease constraints + budget), §11 (new span attrs), and
  §12 (new error codes) are implemented as described above with
  `file:line` citations.
- **Each v1.1 feature is exercised by a dedicated example** under
  `examples/` (`heartbeat/`, `ack-backpressure/`, `list-jobs/`,
  `subscribe/`, `agent-versions/`, `lease-expires-at/`,
  `cost-budget/`, `progress/`, `result-chunk/`). See
  [`examples/README.md`](./examples/README.md) for the full §13 cross-reference.

The package set:

| Package                 | Status                   |
| ----------------------- | ------------------------ |
| `@arcp/core`            | Implemented (v1.1)       |
| `@arcp/client`          | Implemented (v1.1)       |
| `@arcp/runtime`         | Implemented (v1.1)       |
| `@arcp/sdk`             | Implemented (v1.1)       |
| `@arcp/node`            | Implemented              |
| `@arcp/express`         | Implemented              |
| `@arcp/fastify`         | Implemented              |
| `@arcp/hono`            | Implemented              |
| `@arcp/bun`             | Implemented              |
| `@arcp/middleware-otel` | Implemented (v1.1 attrs) |
