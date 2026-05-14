# @arcp/core

Wire-level primitives shared by client and runtime. If you're writing
a custom transport, a custom auth verifier, or a third-party
implementation against the ARCP spec, this is the package you depend
on.

## Install

```sh
pnpm add @arcp/core
```

Most apps don't install this explicitly — it's a transitive of
`@arcp/client`, `@arcp/runtime`, and `@arcp/sdk`.

## Public surface

### Envelopes

```ts
import {
  Envelope,            // discriminated union of every message type
  EnvelopeSchema,      // Zod schema covering Envelope
  BaseEnvelope,        // common envelope fields
  buildEnvelope,       // helper to construct + validate
  messageEnvelope,     // build per-message-type envelope
  isPreSessionType,    // checks if a type may flow before session.welcome
  isValidTraceId,      // 32-hex check
} from "@arcp/core";
```

Every message type has a corresponding Zod schema in
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
} from "@arcp/core";

import {
  newId,
  newJobId,
  newMessageId,
  newSessionId,
} from "@arcp/core";
```

Brand types prevent accidental cross-assignment between e.g.
`JobId` and `SessionId`. Use the `new*Id()` helpers to mint new
instances.

### Errors

```ts
import {
  ARCPError,               // base
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
  ERROR_CODES,
  isErrorCode,
  isRetryableByDefault,
} from "@arcp/core";
```

See [errors guide](../guides/errors.md) for shape, retryability, and
patterns.

### Transports

```ts
import {
  Transport,               // interface
  WireFrame,
  SendableFrame,
  FrameHandler,
  MemoryTransport,
  pairMemoryTransports,
  StdioTransport,
  WebSocketTransport,
  startWebSocketServer,
  WebSocketServerHandle,
} from "@arcp/core";
```

`Transport` is a four-method interface. See [transports.md](../transports.md)
for the contract and existing implementations.

### Session state

```ts
import {
  SessionState,       // phase machine
  SessionPhase,       // "pre-handshake" | "awaiting-welcome" | "accepted" | "closed"
  SessionSnapshot,    // read-only view
  PendingRegistry,    // pending-request correlation
  PendingMeta,
  negotiateCapabilities,
} from "@arcp/core";
```

`SessionState` is the source of truth for what a session can do at
any moment. `PendingRegistry` tracks outstanding requests waiting on
responses (e.g., a `client.submit()` waiting for `job.accepted`).

### Storage

```ts
import {
  EventLog,
  EventLogFilter,
  EventLogOptions,
  ParsedRowEnvelope,
  EventRowEnvelopeSchema,
} from "@arcp/core";
```

`EventLog` is the interface for resume-buffer persistence. The
default in-memory implementation is sufficient for most cases; for
durable resume across runtime restarts, drop in a SQLite backend.

### Auth

```ts
import {
  BearerVerifier,
  BearerIdentity,
  StaticBearerVerifier,
} from "@arcp/core";
```

See [auth guide](../guides/auth.md) for custom verifier patterns.

### Logging

```ts
import {
  Logger,           // pino-shaped interface
  rootLogger,
  sessionLogger,
  silentLogger,
} from "@arcp/core";
```

`sessionLogger(parent, bindings)` returns a child logger with the
bindings attached to every log line. The runtime's `ctx.logger` is
pre-bound to `session_id` and `job_id`.

### Extension classification

```ts
import {
  CORE_MESSAGE_TYPES,
  CoreMessageType,
  classifyUnknownType,             // → "core" | "vendor-extension" | "unknown"
  isCoreType,
  isVendorExtensionName,
  validateExtensionsObject,
  UnknownTypeDisposition,
  VendorExtensionName,
} from "@arcp/core";
```

See [vendor-extensions guide](../guides/vendor-extensions.md) for the
rules these helpers enforce.

### Versioning + features

```ts
import {
  IMPL_VERSION,
  PROTOCOL_VERSION,        // "1"
  ProtocolVersion,
  intersectFeatures,
  isCompatibleVersion,
  V1_1_FEATURES,           // tuple of v1.1 feature names
  V1_1_Feature,            // union type
} from "@arcp/core";
```

`negotiateCapabilities()` uses these to compute the intersection of
client and runtime feature sets during handshake.

### Utilities

```ts
import {
  combineSignals,         // merge multiple AbortSignals
  Deferred,               // a promise + resolve/reject in one object
  validateAgainstSchema,  // zod with friendlier errors
  safeSetInterval,        // unref'd + clearable interval
  safeSetTimeout,
  nowTimestamp,
} from "@arcp/core";
```

## Module layout

```
packages/core/src/
  envelope.ts            # buildEnvelope, base shape
  errors.ts              # ARCPError + per-code classes
  extensions.ts          # x-vendor.* classification
  brands.ts              # branded ID types
  logger.ts              # logger + helpers
  types.ts               # cross-cutting types
  version.ts             # protocol version + feature negotiation
  auth/                  # BearerVerifier + StaticBearerVerifier
  messages/              # one schema per message type
  state/                 # SessionState, PendingRegistry
  store/                 # EventLog interface + default impl
  transport/             # memory, stdio, ws
  util/                  # signals, deferred, ids, etc.
```

## Stability

`@arcp/core` is the most stable part of the SDK — its shapes are
implementations of the spec. Breaking changes here mean a spec
revision. Minor additions (v1.1 features) are gated behind the
feature negotiation system.
