/**
 * Consolidated type surface for `messages/*.ts`.
 *
 * Schemas live with their definitions (artifacts/control/execution/session/
 * telemetry); the inferred TS types are re-exported here so consumers have a
 * single import path for the message-layer type API.
 */
export type { ArtifactRef } from "./artifacts.js";
export type {
  ArtifactRefBody,
  DelegateBody,
  JobAcceptedPayload,
  JobBudget,
  JobCancelPayload,
  JobErrorFinalStatus,
  JobErrorPayload,
  JobEventPayload,
  JobResultPayload,
  JobStateName,
  JobSubmitPayload,
  JobSubscribedPayload,
  JobSubscribePayload,
  JobUnsubscribePayload,
  Lease,
  LeaseConstraints,
  LogBody,
  MetricBody,
  ParsedAgentRef,
  ParsedBudgetAmount,
  ProgressBody,
  ReservedCapabilityName,
  ReservedEventKind,
  ResultChunkBody,
  StatusBody,
  TerminalJobState,
  ThoughtBody,
  ToolCallBody,
  ToolResultBody,
} from "./execution.js";
export type {
  AgentInventoryEntry,
  AuthCredential,
  AuthScheme,
  Capabilities,
  ClientIdentity,
  JobListEntry,
  RuntimeIdentity,
  SessionAckPayload,
  SessionByePayload,
  SessionErrorPayload,
  SessionHelloPayload,
  SessionJobsPayload,
  SessionListJobsFilter,
  SessionListJobsPayload,
  SessionPingPayload,
  SessionPongPayload,
  SessionResume,
  SessionWelcomePayload,
} from "./session.js";
export type { LogLevel, LogPayload, MetricPayload } from "./telemetry.js";
