# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-10

### Added

- Initial reference SDK release aligned with ARCP protocol v1.1.
- Wire envelopes carry `arcp: "1.1"` (`PROTOCOL_VERSION`).
- v1.0 surface: sessions, jobs, leases, delegation, resume, idempotency,
  WebSocket / stdio / in-memory transports, bearer auth.
- v1.1 features negotiated via `capabilities.features`: `heartbeat`, `ack`,
  `list_jobs`, `subscribe`, `lease_expires_at`, `cost.budget`, `progress`,
  `result_chunk`, `agent_versions`, `model.use`, `provisioned_credentials`.
- v1.1 error codes: `AGENT_VERSION_NOT_AVAILABLE`, `LEASE_EXPIRED`,
  `BUDGET_EXHAUSTED` (15 codes total).
- Packages: `@agentruntimecontrolprotocol/core`, `/client`, `/runtime`,
  `/sdk`, plus host middleware `/node`, `/express`, `/fastify`, `/hono`,
  `/bun`, and `/middleware-otel`.
- Effect-native surface alongside the legacy Promise/class API
  (`ARCPRuntimeLayer`, `ARCPClientLayer`, `JobService`, `LoggerLayer`,
  etc.).
