// Public surface of @arcp/core — shared primitives consumed by @arcp/client
// and @arcp/runtime. See ARCP v1.1 for the protocol spec.

export * from "./auth/index.js";
export type {
  Brand,
  EventSeq,
  JobId,
  MessageId,
  ResumeToken,
  SessionId,
  TraceId,
} from "./brands.js";
export {
  type BaseEnvelope,
  BaseEnvelopeSchema,
  buildEnvelope,
  EnvelopeExtensionsSchema,
  type EnvelopeOptionalFields,
  isPreSessionType,
  isValidTraceId,
  messageEnvelope,
  pickDefined,
  type RoundTripEnvelope,
  RoundTripEnvelopeSchema,
} from "./envelope.js";
export {
  AgentNotAvailableError,
  AgentVersionNotAvailableError,
  ARCPError,
  type ARCPErrorOptions,
  BudgetExhaustedError,
  CancelledError,
  DuplicateKeyError,
  ERROR_CODES,
  type ErrorCode,
  type ErrorPayload,
  ErrorPayloadSchema,
  HeartbeatLostError,
  InternalError,
  InvalidRequestError,
  isErrorCode,
  isRetryableByDefault,
  JobNotFoundError,
  LeaseExpiredError,
  LeaseSubsetViolationError,
  PermissionDeniedError,
  ResumeWindowExpiredError,
  type SdkError,
  TimeoutError,
  UnauthenticatedError,
} from "./errors.js";
export {
  arcpFromTagged,
  TaggedAgentNotAvailable,
  TaggedAgentVersionNotAvailable,
  TaggedBudgetExhausted,
  TaggedCancelled,
  TaggedDuplicateKey,
  taggedFromARCP,
  TaggedHeartbeatLost,
  TaggedInternal,
  TaggedInvalidRequest,
  TaggedJobNotFound,
  TaggedLeaseExpired,
  TaggedLeaseSubsetViolation,
  TaggedPermissionDenied,
  TaggedResumeWindowExpired,
  type TaggedSdkError,
  TaggedTimeout,
  TaggedUnauthenticated,
} from "./errors-tagged.js";
export {
  TaggedTransportError,
  transportSendError,
} from "./transport-error.js";
export {
  CORE_MESSAGE_TYPES,
  type CoreMessageType,
  classifyUnknownType,
  isCoreType,
  isVendorExtensionName,
  looksLikeCoreType,
  type UnknownTypeDisposition,
  validateExtensionsObject,
  type VendorExtensionName,
} from "./extensions.js";
export {
  type Logger,
  LoggerLayer,
  makePinoEffectLogger,
  PinoLogger,
  rootLogger,
  sessionLogger,
  sessionLoggerEffect,
  silentLogger,
} from "./logger.js";
export * from "./messages/index.js";
export * from "./state/index.js";
export * from "./store/index.js";
export * from "./transport/index.js";
export * from "./util/index.js";
export {
  IMPL_VERSION,
  intersectFeatures,
  isCompatibleVersion,
  PROTOCOL_VERSION,
  type ProtocolVersion,
  V1_1_FEATURES,
  type V1_1_Feature,
} from "./version.js";
