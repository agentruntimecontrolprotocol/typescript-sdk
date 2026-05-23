# @agentruntimecontrolprotocol/core

Wire-level primitives shared by client and runtime. If you're writing
a custom transport, a custom auth verifier, or a third-party
implementation against the ARCP spec, this is the package you depend
on.

## Install

```sh
pnpm add @agentruntimecontrolprotocol/core
```

Most apps don't install this explicitly — it's a transitive of
`@agentruntimecontrolprotocol/client`, `@agentruntimecontrolprotocol/runtime`, and `@agentruntimecontrolprotocol/sdk`.

## Public surface

### Envelopes

```ts
import {
  type Envelope, // discriminated union of every message type
  EnvelopeSchema, // Effect Schema covering Envelope
  type BaseEnvelope, // common envelope fields
  BaseEnvelopeSchema,
  buildEnvelope, // helper to construct + validate
  messageEnvelope, // build per-message-type envelope
  isPreSessionType, // checks if a type may flow before session.welcome
  isValidTraceId, // 32-hex check
  RoundTripEnvelopeSchema, // permissive schema preserving unknown fields
  pickDefined,
  EnvelopeExtensionsSchema,
} from "@agentruntimecontrolprotocol/core";
```

Every message type has a corresponding Effect `Schema` in
[`packages/core/src/messages/`](../../packages/core/src/messages/).
The discriminator field is `type`.

### Branded IDs

```ts
import type {
  Brand,
  EventSeq,
  JobId,
  MessageId,
  ResumeToken,
  SessionId,
  TraceId,
} from "@agentruntimecontrolprotocol/core";

import { newId, newJobId, newMessageId, newSessionId } from "@agentruntimecontrolprotocol/core";
```

Brand types prevent accidental cross-assignment between e.g.
`JobId` and `SessionId`. Use the `new*Id()` helpers to mint new
instances.

### Errors

```ts
import {
  ARCPError, // base
  AgentNotAvailableError,
  AgentVersionNotAvailableError,
  BudgetExhaustedError,
  CancelledError,
  DuplicateKeyError,
  HeartbeatLostError,
  InternalError,
  InvalidRequestError,
  JobNotFoundError,
  LeaseExpiredError,
  LeaseSubsetViolationError,
  PermissionDeniedError,
  ResumeWindowExpiredError,
  TimeoutError,
  UnauthenticatedError,
  // taxonomy:
  ERROR_CODES, // 15 canonical v1.1 codes
  isErrorCode,
  isRetryableByDefault, // true only for INTERNAL_ERROR + TIMEOUT
  type SdkError, // discriminated union of every typed error
  type ErrorPayload,
  ErrorPayloadSchema,
} from "@agentruntimecontrolprotocol/core";
```

For Effect-tagged twins (used by typed-error pipelines), import
`TaggedAgentNotAvailable`, `TaggedTimeout`, `TaggedTransportError`,
etc., from the same package — see
[`packages/core/src/errors-tagged.ts`](../../packages/core/src/errors-tagged.ts).
`taggedFromARCP(err)` / `arcpFromTagged(tagged)` round-trip between
the two surfaces.

See [errors guide](../guides/errors.md) for shape, retryability, and
patterns.

### Transports

```ts
import {
  type Transport, // legacy callback interface
  type TransportEffect, // Effect-shaped twin (Stream-based incoming)
  type WireFrame,
  type SendableFrame,
  type FrameHandler,
  MemoryTransport,
  pairMemoryTransports,
  memoryTransportEffect,
  StdioTransport,
  stdioTransportEffect,
  WebSocketTransport,
  websocketTransportEffect,
  startWebSocketServer,
  type WebSocketServerHandle,
} from "@agentruntimecontrolprotocol/core";
```

`Transport` is the legacy callback-style interface;
`TransportEffect` exposes the same channel as a
`Stream<WireFrame, TaggedTransportError>` plus Effect-typed `send` and
`close`. See [transports.md](../transports.md) for the contract and
existing implementations.

### Session state

```ts
import {
  SessionState, // phase machine (legacy class)
  SessionStateService, // Effect-shaped twin
  type SessionPhase, // "opening" | "accepted" | "closing" | "rejected"
  type SessionSnapshot, // read-only view
  PendingRegistry, // pending-request correlation (legacy)
  PendingRegistryService, // Effect-shaped twin
  type PendingMeta,
  negotiateCapabilities,
} from "@agentruntimecontrolprotocol/core";
```

`SessionState` is the source of truth for what a session can do at
any moment; transitions follow `opening → accepted → closing` (or
`opening → rejected` on rejection). `PendingRegistry` tracks
outstanding requests waiting on responses (e.g., a `client.submit()`
waiting for `job.accepted`).

### Storage

```ts
import {
  EventLog, // SQLite-backed class (legacy)
  EventLogService, // Effect-shaped twin
  eventLogLayer,
  type EventLogFilter,
  type EventLogOptions,
  type ParsedRowEnvelope,
  EventRowEnvelopeSchema,
} from "@agentruntimecontrolprotocol/core";
```

`EventLog` wraps `better-sqlite3` and is the runtime's
resume-buffer store. It defaults to `:memory:`; pass `{ path: "..."
}` (or `{ db: existingDatabase }`) to persist across restarts. The
class is the contract — subclass it to back the same surface with
another store. `EventLogService` is the Effect-aware twin.

### Auth

```ts
import {
  type BearerVerifier, // Promise-shaped legacy interface
  type BearerVerifierEffect, // Effect-shaped twin
  type BearerIdentity,
  StaticBearerVerifier,
  BearerVerifierService,
  staticBearerVerifierLayer,
} from "@agentruntimecontrolprotocol/core";
```

See [auth guide](../guides/auth.md) for custom verifier patterns.

### Logging

```ts
import {
  type Logger, // pino-shaped type alias
  rootLogger,
  sessionLogger, // (parent, sessionId) → child logger pre-bound to session_id
  silentLogger,
  LoggerLayer, // Effect default-logger replacement
  PinoLogger,
  makePinoEffectLogger,
  sessionLoggerEffect, // annotate session_id on every log inside the scope
} from "@agentruntimecontrolprotocol/core";
```

`sessionLogger(parent, sessionId)` returns a child logger with
`session_id` attached to every log line. The runtime's `ctx.logger`
adds further bindings (`client`, etc.) and the per-job logger nests a
`job_id` binding inside that. For Effect-aware code, compose
`LoggerLayer` at the program edge so every `Effect.log*` call goes
through pino.

### Extension classification

```ts
import {
  CORE_MESSAGE_TYPES,
  CoreMessageType,
  classifyUnknownType, // → "core" | "vendor-extension" | "unknown"
  isCoreType,
  isVendorExtensionName,
  validateExtensionsObject,
  UnknownTypeDisposition,
  VendorExtensionName,
} from "@agentruntimecontrolprotocol/core";
```

See [vendor-extensions guide](../guides/vendor-extensions.md) for the
rules these helpers enforce.

### Versioning + features

```ts
import {
  IMPL_VERSION,
  PROTOCOL_VERSION, // "1.1"
  ProtocolVersion,
  intersectFeatures,
  isCompatibleVersion,
  V1_1_FEATURES, // tuple of v1.1 feature names
  V1_1_Feature, // union type
} from "@agentruntimecontrolprotocol/core";
```

`negotiateCapabilities()` uses these to compute the intersection of
client and runtime feature sets during handshake.

### Utilities

```ts
import {
  combineSignals, // merge multiple AbortSignals
  Deferred, // a promise + resolve/reject in one object
  validateAgainstSchema, // Effect Schema with friendlier errors
  safeSetInterval, // unref'd + clearable interval
  safeSetTimeout,
  nowTimestamp,
  newId, // raw ULID, optionally prefixed
  newJobId,
  newMessageId,
  newSessionId,
  IdGen, // Effect-shaped id generator service
} from "@agentruntimecontrolprotocol/core";
```

## Module layout

```
packages/core/src/
  envelope.ts            # buildEnvelope, base shape
  errors.ts              # ARCPError + per-code classes
  errors-tagged.ts       # Effect-tagged twins
  transport-error.ts     # TaggedTransportError + helpers
  extensions.ts          # x-vendor.* classification
  brands.ts              # branded ID types
  logger.ts              # legacy + Effect logger bridge
  types.ts               # cross-cutting types
  version.ts             # protocol version + feature negotiation
  auth/                  # BearerVerifier + StaticBearerVerifier + Effect twins
  messages/              # one schema per message type
  state/                 # SessionState, PendingRegistry, Effect twins
  store/                 # EventLog (SQLite) + EventLogService
  transport/             # memory, stdio, ws + *Effect twins
  util/                  # signals, deferred, ids, etc.
```

## Stability

`@agentruntimecontrolprotocol/core` is the most stable part of the SDK — its shapes are
implementations of the spec. Breaking changes here mean a spec
revision. Minor additions (v1.1 features) are gated behind the
feature negotiation system.
