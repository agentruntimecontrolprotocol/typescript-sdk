/**
 * Aggregate registry of every core message type defined in RFC 0001 v2 §6.2.
 *
 * `EnvelopeSchema` is the discriminated union over `type`. Parsing an inbound
 * envelope through this schema yields a fully-typed envelope value or a
 * `ZodError` on unknown/invalid types — which the runtime translates to a
 * `nack` with `code: UNIMPLEMENTED` (§21.3).
 */
import { z } from "zod";
import { ARTIFACT_ENVELOPES } from "./artifacts.js";
import { CONTROL_ENVELOPES } from "./control.js";
import { EXECUTION_ENVELOPES } from "./execution.js";
import { HUMAN_ENVELOPES } from "./human.js";
import { PERMISSION_ENVELOPES } from "./permissions.js";
import { SESSION_ENVELOPES } from "./session.js";
import { STREAMING_ENVELOPES } from "./streaming.js";
import { SUBSCRIPTION_ENVELOPES } from "./subscriptions.js";
import { TELEMETRY_ENVELOPES } from "./telemetry.js";

export * from "./artifacts.js";
export * from "./control.js";
export * from "./execution.js";
export * from "./human.js";
export * from "./permissions.js";
export * from "./session.js";
export * from "./streaming.js";
export * from "./subscriptions.js";
export * from "./telemetry.js";

const ALL_ENVELOPES = [
  ...SESSION_ENVELOPES,
  ...CONTROL_ENVELOPES,
  ...EXECUTION_ENVELOPES,
  ...STREAMING_ENVELOPES,
  ...HUMAN_ENVELOPES,
  ...PERMISSION_ENVELOPES,
  ...SUBSCRIPTION_ENVELOPES,
  ...ARTIFACT_ENVELOPES,
  ...TELEMETRY_ENVELOPES,
] as const;

/**
 * Discriminated union of every core ARCP envelope. Use this to validate an
 * inbound message after it has been parsed from JSON; failures indicate
 * either an unknown `type` (§21.3) or a malformed payload.
 *
 * Implementation note: zod's `discriminatedUnion` expects a non-empty tuple
 * `[T, ...T[]]`. The single cast widens the heterogeneous tuple type from
 * `as const` (above) to a homogeneous one over the element union.
 */
type EnvelopeElement = (typeof ALL_ENVELOPES)[number];
export const EnvelopeSchema = z.discriminatedUnion(
  "type",
  ALL_ENVELOPES as readonly [EnvelopeElement, ...EnvelopeElement[]],
);

export type Envelope = z.infer<typeof EnvelopeSchema>;

/**
 * Implementation status of a message type:
 *  - `implemented`: full handler exists in the runtime.
 *  - `stub`: schema exists; runtime returns `nack UNIMPLEMENTED` per §21.
 */
export type MessageStatus = "implemented" | "stub";

const STUB_TYPES = new Set([
  "checkpoint.create",
  "checkpoint.restore",
  "job.schedule",
  "workflow.start",
  "workflow.complete",
  "agent.delegate",
  "agent.handoff",
]);

/** Whether the runtime has a real handler for `type` in v0.1. */
export function messageStatus(type: string): MessageStatus {
  return STUB_TYPES.has(type) ? "stub" : "implemented";
}

/** All message types we ship a real handler for in v0.1. */
export function isImplementedType(type: string): boolean {
  return messageStatus(type) === "implemented";
}
