// Public surface of the `arcp` package. v0.1 — see RFC-0001-v2.md.

export {
  type BaseEnvelope,
  BaseEnvelopeSchema,
  buildEnvelope,
  EnvelopeExtensionsSchema,
  type EnvelopeOptionalFields,
  messageEnvelope,
  type Priority,
  PrioritySchema,
  pickDefined,
  type RoundTripEnvelope,
  RoundTripEnvelopeSchema,
} from "./envelope.js";

export {
  // Subclasses
  AbortedError,
  ARCPError,
  type ARCPErrorOptions,
  BackpressureOverflowError,
  CancelledError,
  DataLossError,
  DeadlineExceededError,
  ERROR_CODES,
  type ErrorCode,
  type ErrorPayload,
  ErrorPayloadSchema,
  FailedPreconditionError,
  HeartbeatLostError,
  InternalError,
  InvalidArgumentError,
  isErrorCode,
  isRetryableByDefault,
  LeaseExpiredError,
  LeaseRevokedError,
  NotFoundError,
  NotImplementedError,
  PermissionDeniedError,
  RATE_LIMITED,
  UnauthenticatedError,
} from "./errors.js";
export {
  CORE_MESSAGE_TYPES,
  type CoreMessageType,
  classifyUnknownType,
  ExtensionRegistry,
  isCoreType,
  isExtensionName,
  looksLikeCoreType,
  type UnknownTypeDisposition,
  validateExtensionsObject,
} from "./extensions.js";
export { type Logger, rootLogger, sessionLogger, silentLogger } from "./logger.js";
export {
  EventLog,
  type EventLogFilter,
  type EventLogOptions,
  EventRowEnvelopeSchema,
  type ParsedRowEnvelope,
} from "./store/eventlog.js";
export {
  newArtifactId,
  newId,
  newJobId,
  newLeaseId,
  newMessageId,
  newSessionId,
  newStreamId,
  newSubscriptionId,
  nowTimestamp,
} from "./util/ulid.js";
export { IMPL_VERSION, isCompatibleVersion, PROTOCOL_VERSION } from "./version.js";

// Phase 2 surface ----------------------------------------------------------

export {
  type BearerIdentity,
  type BearerVerifier,
  type JwtKey,
  JwtVerifier,
  StaticBearerVerifier,
} from "./auth/index.js";
export {
  ARCPClient,
  type ARCPClientOptions,
  asEnvelopeOfType,
  type ClientHandler,
  DenyAllPermissionHandler,
  type HumanInputHandler,
  type PermissionDecisionHandler,
} from "./client/index.js";
export * from "./messages/index.js";
export {
  ARCPServer,
  type ARCPServerOptions,
  type Handler,
  negotiateCapabilities,
  SessionContext,
  type SessionPhase,
  type SessionSnapshot,
  SessionState,
} from "./runtime/index.js";
export type { FrameHandler, Transport, WireFrame } from "./transport/base.js";
export { MemoryTransport, pairMemoryTransports } from "./transport/memory.js";

export { Deferred } from "./util/deferred.js";
