/**
 * Aggregated type-only barrel for `@arcp/core`.
 *
 * Use this entry point for a single import path covering the public TS type
 * surface of the package:
 *
 * ```ts
 * import type {
 *   Envelope, JobEvent, Lease, ErrorCode, SessionId, JobId, EventSeq,
 * } from "@arcp/core/types";
 * ```
 *
 * The per-subpath entry points (`@arcp/core/envelope`, `@arcp/core/errors`,
 * `@arcp/core/messages`, ...) stay; this barrel is purely additive.
 */
export type { Brand, EventSeq, JobId, MessageId, ResumeToken, SessionId, TraceId, } from "./brands.js";
export type { BaseEnvelope, EnvelopeOptionalFields, RoundTripEnvelope, } from "./envelope.js";
export type { ARCPErrorOptions, ErrorCode, ErrorPayload } from "./errors.js";
export type { CoreMessageType, UnknownTypeDisposition, VendorExtensionName, } from "./extensions.js";
export type { Logger } from "./logger.js";
export type { AgentInventoryEntry, ArtifactRef, ArtifactRefBody, AuthCredential, AuthScheme, Capabilities, ClientIdentity, DelegateBody, Envelope, JobAcceptedPayload, JobBudget, JobCancelPayload, JobErrorFinalStatus, JobErrorPayload, JobEventPayload, JobListEntry, JobResultPayload, JobStateName, JobSubmitPayload, JobSubscribePayload, JobSubscribedPayload, JobUnsubscribePayload, Lease, LeaseConstraints, LogBody, LogLevel, LogPayload, MetricBody, MetricPayload, ParsedAgentRef, ParsedBudgetAmount, ProgressBody, ReservedCapabilityName, ReservedEventKind, ResultChunkBody, RuntimeIdentity, SessionAckPayload, SessionByePayload, SessionErrorPayload, SessionHelloPayload, SessionJobsPayload, SessionListJobsFilter, SessionListJobsPayload, SessionPingPayload, SessionPongPayload, SessionResume, SessionWelcomePayload, StatusBody, TerminalJobState, ThoughtBody, ToolCallBody, ToolResultBody, } from "./messages/index.js";
export type { PendingMeta, SessionPhase, SessionSnapshot, } from "./state/index.js";
export type { EventLogFilter, EventLogOptions } from "./store/types.js";
export type { ParsedRowEnvelope } from "./store/eventlog.js";
export type { FrameHandler, SendableFrame, Transport, WebSocketServerHandle, WireFrame, } from "./transport/index.js";
export type { ValidationError } from "./util/index.js";
export type { ProtocolVersion, V1_1_Feature } from "./version.js";
export type { BearerIdentity, BearerVerifier } from "./auth/index.js";
//# sourceMappingURL=types.d.ts.map