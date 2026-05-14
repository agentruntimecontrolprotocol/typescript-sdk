// Public surface of @arcp/core — shared primitives consumed by @arcp/client
// and @arcp/runtime. See ARCP v1.0 for the protocol spec.

export * from "./auth/index.js";
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
  ARCPError,
  type ARCPErrorOptions,
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
  LeaseSubsetViolationError,
  PermissionDeniedError,
  ResumeWindowExpiredError,
  TimeoutError,
  UnauthenticatedError,
} from "./errors.js";
export {
  CORE_MESSAGE_TYPES,
  type CoreMessageType,
  classifyUnknownType,
  isCoreType,
  isVendorExtensionName,
  looksLikeCoreType,
  type UnknownTypeDisposition,
  validateExtensionsObject,
} from "./extensions.js";
export {
  type Logger,
  rootLogger,
  sessionLogger,
  silentLogger,
} from "./logger.js";
export * from "./messages/index.js";
export * from "./state/index.js";
export * from "./store/index.js";
export * from "./transport/index.js";
export * from "./util/index.js";
export {
  IMPL_VERSION,
  isCompatibleVersion,
  PROTOCOL_VERSION,
} from "./version.js";
