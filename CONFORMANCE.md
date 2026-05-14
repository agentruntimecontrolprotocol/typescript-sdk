# Conformance — ARCP v1.0

This SDK targets [ARCP v1.0](../spec/docs/draft-arcp-02.md) (May 2026 draft, 16 sections).
Status is tracked per spec section below. Citations are anchored to
the current SDK state.

- **Implemented** — feature is present and matches the spec.
- **Deferred** — feature is intentionally not yet implemented, with rationale.

---

## §4. Transport

| Requirement | Status | Location |
|---|---|---|
| §4.1 WebSocket MUST be supported (`wss://`, `/arcp` path) | Implemented | `packages/core/src/transport/websocket.ts` (`WebSocketTransport`); `packages/middleware/node/src/index.ts` (path defaults to `/arcp`) |
| §4.1 JSON text frames only | Implemented | `packages/core/src/transport/websocket.ts` discards binary frames |
| §4.2 stdio newline-delimited JSON | Implemented | `packages/core/src/transport/stdio.ts` |
| §4.3 Alternate transports MAY exist | Implemented | `MemoryTransport` (`packages/core/src/transport/memory.ts`) is the in-process test transport |

## §5. Wire Format

| Requirement | Status | Location |
|---|---|---|
| §5.1 `arcp` field, REQUIRED, MUST be `"1"` | Implemented | `packages/core/src/version.ts:PROTOCOL_VERSION = "1"`; `packages/core/src/envelope.ts` rejects other values |
| §5.1 `id` REQUIRED, ULID/UUIDv7 | Implemented | `packages/core/src/util/ulid.ts`; emitted by `buildEnvelope` |
| §5.1 `type` REQUIRED | Implemented | `packages/core/src/envelope.ts` |
| §5.1 `session_id` REQUIRED on post-welcome envelopes | Implemented | Per-message schemas in `packages/core/src/messages/{session,execution}.ts` extend with `session_id: z.string().min(1)` on every post-welcome type |
| §5.1 `trace_id` OPTIONAL, W3C 32-hex | Implemented | `packages/core/src/envelope.ts:isValidTraceId` enforces /^[0-9a-f]{32}$/ |
| §5.1 `job_id` REQUIRED when applicable | Implemented | `packages/core/src/messages/execution.ts` extends per-type with `job_id: z.string().min(1)` |
| §5.1 `event_seq` REQUIRED on `job.event`/`job.result`/`job.error` (monotonic, session-scoped) | Implemented | Schemas enforce `event_seq: z.number().int().nonnegative()`; emitted by `Job.emitEventKind` / `emitResult` / `emitErrorEnvelope` via `SessionContext.nextEventSeq()` |
| §5.1 `payload` REQUIRED | Implemented | `packages/core/src/envelope.ts` |
| §5.1 Unknown top-level fields MUST be ignored | Implemented | `RoundTripEnvelopeSchema` uses `.passthrough()` |
| §5.2 JSON / UTF-8 / int64 only | Implemented | JSON-only transports |

## §6. Sessions

| Requirement | Status | Location |
|---|---|---|
| §6.1 Bearer-token authentication on `session.hello` | Implemented | `packages/core/src/auth/bearer.ts`; runtime path `packages/runtime/src/server.ts:authenticate()` |
| §6.1 Reject missing/invalid token with `session.error` + close | Implemented | `packages/runtime/src/server.ts:emitSessionError` + `terminate` |
| §6.2 hello payload `client`/`auth`/`capabilities`; welcome payload `runtime`/`resume_token`/`resume_window_sec`/`capabilities` | Implemented | `packages/core/src/messages/session.ts` |
| §6.2 `capabilities` is small: at minimum `encodings` (client) and `encodings`+`agents` (runtime) | Implemented | `packages/core/src/messages/session.ts:CapabilitiesSchema` |
| §6.2 Runtime MUST issue `resume_token` (≥128 bits entropy); client MUST treat as credential | Implemented | `packages/runtime/src/server.ts:newResumeToken()` uses 32 random bytes (256 bits) |
| §6.2 `resume_token` rotated on every welcome | Implemented | `packages/runtime/src/server.ts:handleResume` writes a fresh token to `resumeStore` and emits in the new welcome |
| §6.3 Resume via `session.hello.payload.resume = { session_id, resume_token, last_event_seq }` | Implemented | `packages/core/src/messages/session.ts:SessionHelloPayloadSchema` |
| §6.3 On resume, replay `event_seq > last_event_seq`, issue new welcome with same `session_id`, resume streaming | Implemented | `packages/runtime/src/server.ts:handleResume` reads via `EventLog.readSinceSeq` and re-sends frames |
| §6.3 `RESUME_WINDOW_EXPIRED` on stale resume | Implemented | `packages/core/src/errors.ts:ResumeWindowExpiredError`; emitted in `server.ts:handleResume` |
| §6.4 Clean close via `session.bye { reason }` | Implemented | `packages/core/src/messages/session.ts:SessionByePayloadSchema` |
| §6.4 Either side MAY initiate; no further messages post-bye | Implemented | `packages/runtime/src/server.ts:terminate` is idempotent |

## §7. Jobs

| Requirement | Status | Location |
|---|---|---|
| §7.1 `job.submit` with `agent`/`input`/`lease_request?`/`idempotency_key?`/`max_runtime_sec?` | Implemented | `packages/core/src/messages/execution.ts:JobSubmitPayloadSchema` |
| §7.1 Runtime → `job.accepted { job_id, lease, accepted_at, parent_job_id?, delegate_id?, trace_id? }` | Implemented | `packages/core/src/messages/execution.ts:JobAcceptedPayloadSchema`; `packages/runtime/src/job.ts:emitAccepted` |
| §7.1 Runtime MAY reduce, MUST NOT expand the lease | Implemented | `packages/runtime/src/lease.ts:validateLeaseShape`; no expansion path exists |
| §7.2 Transport-level idempotency via envelope `id` (dedupe) | Implemented | `packages/core/src/store/eventlog.ts:append` is `INSERT OR IGNORE`; `SessionContext.dispatchRaw` short-circuits on duplicate |
| §7.2 Logical idempotency via `payload.idempotency_key`; same key+principal within ~24h → same `job_id` | Implemented | `packages/runtime/src/server.ts:idempotencyStore` and `handleJobSubmit` |
| §7.2 Different agent/input under same key → `DUPLICATE_KEY` | Implemented | `packages/runtime/src/server.ts:handleJobSubmit`; `packages/core/src/errors.ts:DuplicateKeyError` |
| §7.3 States: `pending`, `running`, `success`, `error`, `cancelled`, `timed_out` | Implemented | `packages/core/src/messages/execution.ts:JOB_STATES`; `packages/runtime/src/job.ts:JOB_TRANSITIONS` |
| §7.3 Terminal events `job.result` (success) / `job.error` (failure variants), with `final_status` | Implemented | `packages/core/src/messages/execution.ts:JobResultPayloadSchema`, `JobErrorPayloadSchema`; `packages/runtime/src/job.ts:emitResult`, `emitErrorEnvelope` |
| §7.4 Cancellation via `job.cancel { reason }`; runtime emits `job.error{final_status:"cancelled"}` within 30s grace | Implemented | `packages/runtime/src/server.ts:handleJobCancel` + `cancelGraceMs` (default 30_000) |

## §8. Job Events

| Requirement | Status | Location |
|---|---|---|
| §8.1 Single `job.event` envelope with `payload.kind`/`payload.ts`/`payload.body` | Implemented | `packages/core/src/messages/execution.ts:JobEventPayloadSchema` |
| §8.2 Eight reserved kinds: `log`, `thought`, `tool_call`, `tool_result`, `status`, `metric`, `artifact_ref`, `delegate` | Implemented | `packages/core/src/messages/execution.ts:RESERVED_EVENT_KINDS` + `parseJobEventBody` |
| §8.2 `tool_call.body.call_id` links call/result | Implemented | `ToolCallBodySchema`/`ToolResultBodySchema` both require `call_id` |
| §8.2 Vendor namespace `x-vendor.kind` allowed; unknown kinds ignored | Implemented | `packages/core/src/messages/execution.ts:isVendorEventKind`; `JobEventPayloadSchema` accepts any string kind |
| §8.3 Sequence numbers SESSION-scoped (single space across concurrent jobs) | Implemented | `packages/runtime/src/server.ts:SessionContext.nextEventSeq` |
| §8.3 Strictly monotonic, gap-free across reconnects | Implemented | `SessionContext.setEventSeq` is updated to the highest replayed value after resume |
| §8.3 Per-job ordering preserved within session seq | Implemented | Inherits from the session counter — events for any job are emitted in order |

## §9. Leases

| Requirement | Status | Location |
|---|---|---|
| §9.1 Lease is IMMUTABLE, granted at submit; capability → glob pattern[] | Implemented | `packages/core/src/messages/execution.ts:LeaseSchema`; `packages/runtime/src/lease.ts:validateLeaseShape` |
| §9.2 Reserved namespaces `fs.read`, `fs.write`, `net.fetch`, `tool.call`, `agent.delegate` | Implemented | `packages/core/src/messages/execution.ts:RESERVED_CAPABILITY_NAMES` |
| §9.2 Glob `*` (single segment) / `**` (zero+ segments); anchored | Implemented | `packages/runtime/src/lease.ts:compileGlob`/`matchGlob` |
| §9.3 Runtime MUST validate every operation against the lease; `PERMISSION_DENIED` on fail; no partial-apply | Implemented | `packages/runtime/src/lease.ts:validateLeaseOp` |
| §9.4 Lease subsetting for delegation | Implemented | `packages/runtime/src/lease.ts:isLeaseSubset`/`assertLeaseSubset` |
| §14 Canonicalize paths/URLs before glob check | Implemented | `packages/runtime/src/lease.ts:canonicalizeTarget` |

## §10. Delegation

| Requirement | Status | Location |
|---|---|---|
| §10.1 Delegation as `job.event` with `kind: "delegate"` carrying `{delegate_id, agent, input, lease_request}` | Implemented | `packages/core/src/messages/execution.ts:DelegateBodySchema`; emitted by `JobContext.delegate()` |
| §10.1 Runtime responds with `job.accepted { job_id, parent_job_id, delegate_id, lease }` | Implemented | `packages/runtime/src/server.ts:createDelegateJob` |
| §10.2 Subset validation surfaces failure as `tool_result` event on PARENT with `LEASE_SUBSET_VIOLATION` | Implemented | `packages/runtime/src/server.ts:makeDelegateInterceptor` (emits `tool_result` with `error.code === "LEASE_SUBSET_VIOLATION"` on subset failure) |
| §10.3 Delegated jobs inherit parent `trace_id`; new span MAY be created | Implemented | `packages/runtime/src/server.ts:createDelegateJob` copies `parent.traceId` |

## §11. Trace Propagation

| Requirement | Status | Location |
|---|---|---|
| §11 `trace_id` is W3C 32-hex; client SHOULD include on submit; runtime MUST mint if absent, echo on `job.accepted.payload.trace_id` | Implemented | `packages/runtime/src/server.ts:handleJobSubmit` (`randomBytes(16).toString("hex")` if absent); echoed on accepted |
| §11 Runtime SHOULD emit OTel spans with `arcp.session_id`, `arcp.job_id`, `arcp.agent`, `arcp.lease.capabilities` | Implemented | `packages/middleware/otel/src/index.ts` adds these attributes per envelope |

## §12. Error Taxonomy

| Code | Status | Location |
|---|---|---|
| `PERMISSION_DENIED` | Implemented | `packages/core/src/errors.ts:PermissionDeniedError` |
| `LEASE_SUBSET_VIOLATION` | Implemented | `packages/core/src/errors.ts:LeaseSubsetViolationError` |
| `JOB_NOT_FOUND` | Implemented | `packages/core/src/errors.ts:JobNotFoundError` |
| `DUPLICATE_KEY` | Implemented | `packages/core/src/errors.ts:DuplicateKeyError` |
| `AGENT_NOT_AVAILABLE` | Implemented | `packages/core/src/errors.ts:AgentNotAvailableError` |
| `CANCELLED` | Implemented | `packages/core/src/errors.ts:CancelledError` |
| `TIMEOUT` | Implemented | `packages/core/src/errors.ts:TimeoutError` |
| `RESUME_WINDOW_EXPIRED` | Implemented | `packages/core/src/errors.ts:ResumeWindowExpiredError` |
| `HEARTBEAT_LOST` | Implemented | `packages/core/src/errors.ts:HeartbeatLostError` |
| `INVALID_REQUEST` | Implemented | `packages/core/src/errors.ts:InvalidRequestError` |
| `UNAUTHENTICATED` | Implemented | `packages/core/src/errors.ts:UnauthenticatedError` |
| `INTERNAL_ERROR` | Implemented | `packages/core/src/errors.ts:InternalError` |
| Error payload `{ code, message, retryable, details? }` | Implemented | `packages/core/src/errors.ts:ErrorPayloadSchema` |

The 12 codes above are the *only* values `ErrorCode` admits.

## §13. Examples

Five runnable examples under `examples/`:

| File | Spec |
|---|---|
| `submit-and-stream.ts` | §13.1 |
| `delegate/` (server + client) | §13.2 / §10 |
| `resume.ts` | §13.3 / §6.3 |
| `idempotent-retry.ts` | §13.5 / §7.2 |
| `lease-violation.ts` | §13.4 / §9.3 |

## §14. Security Considerations

| Requirement | Status | Location |
|---|---|---|
| §14 `wss://` required, bearer not over cleartext | Implemented (deployer-controlled) | SDK does not downgrade |
| §14 `resume_token` ≥128 bits entropy | Implemented | `packages/runtime/src/server.ts:newResumeToken` uses 32 random bytes (256 bits) |
| §14 Lease MUST be checked even with sandboxing | Implemented (responsibility) | `validateLeaseOp` is the SDK's interception primitive — agents invoke it; runtimes that sandbox should also call it before allowing the syscall |
| §14 Canonicalize paths/URLs before glob check | Implemented | `packages/runtime/src/lease.ts:canonicalizeTarget` |
| §14 Buffered events at rest: purge at window expiry | Implemented | `packages/runtime/src/server.ts:sweepResume` runs on a 60 s interval; expires stale sessions and resume tokens past `resume_window_sec` |
| §14 Per-session DoS caps (max buffered events / bytes / concurrent jobs); exceed ⇒ `INTERNAL_ERROR` non-retryable | Implemented | `packages/runtime/src/server.ts:SessionContext.checkCaps` + `DEFAULT_MAX_BUFFERED_EVENTS`/`DEFAULT_MAX_BUFFERED_BYTES`/`DEFAULT_MAX_CONCURRENT_JOBS` |

## §15. IANA / Extension namespace

| Requirement | Status | Location |
|---|---|---|
| `x-vendor.*` namespace for vendor extension envelope types and event kinds | Implemented | `packages/core/src/extensions.ts:isVendorExtensionName`; `packages/core/src/messages/execution.ts:isVendorEventKind` |
| Unknown `x-vendor.*` types ignored (drop) | Implemented | `packages/core/src/extensions.ts:classifyUnknownType` |

## §16. References — n/a (informational)

---

## Intentional deferrals

| Item | Why | Effect |
|---|---|---|
| Persistent idempotency store | The runtime ships with an in-memory `idempotencyStore` and a 24-hour TTL sweep. The spec mandates `~24h` semantics but does not require persistence across runtime restarts. | A runtime restart drops idempotency cache. Production deployments are expected to override `idempotencyTtlMs` and/or swap in a persistent map (the runtime accepts `eventLog` for the durable log already; the idempotency map is currently in-process). |
| Sandboxed lease enforcement | The SDK ships `validateLeaseOp` and expects the *agent* (or a runtime-wrapping shim) to call it. A truly opaque sandbox where the runtime intercepts syscalls is out of scope — that belongs to the runtime/host implementation. | Agent authors are responsible for calling `validateLeaseOp(ctx.lease, capability, target)` before performing sensitive ops, or for delegating to a permissioned subsystem. |
| `INVALID_REQUEST` on un-prefixed unknown capabilities | We enforce this strictly — unknown capability names not matching `x-vendor.<vendor>.<cap>` fail `validateLeaseShape` with `INVALID_REQUEST`. | Consumers MUST stick to the five reserved namespaces or use the `x-vendor.*` prefix. |

## Status summary

- **All §4–§15 normative requirements** for v1.0 are implemented as
  described above with `file:line` citations.
- **Spec sections 1–3** (Introduction, Conventions, Terminology) are
  informational and not implementation targets.
- **Spec section 16** (References) is informational.

The package set:

| Package | Status |
|---|---|
| `@arcp/core` | Implemented |
| `@arcp/client` | Implemented |
| `@arcp/runtime` | Implemented |
| `@arcp/sdk` | Implemented |
| `@arcp/node` | Implemented |
| `@arcp/express` | Implemented |
| `@arcp/hono` | Implemented |
| `@arcp/middleware-otel` | Implemented |
