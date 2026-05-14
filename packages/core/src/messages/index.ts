/**
 * Aggregate registry of every core message type defined by ARCP v1.0.
 *
 * `EnvelopeSchema` is the discriminated union over `type`. Parsing an inbound
 * envelope through this schema yields a fully-typed envelope value or a
 * `ZodError` on unknown/invalid types.
 */
import { z } from "zod";
import { ARTIFACT_ENVELOPES } from "./artifacts.js";
import { CONTROL_ENVELOPES } from "./control.js";
import { EXECUTION_ENVELOPES } from "./execution.js";
import { SESSION_ENVELOPES } from "./session.js";
import { TELEMETRY_ENVELOPES } from "./telemetry.js";

export * from "./artifacts.js";
export * from "./control.js";
export * from "./execution.js";
export * from "./session.js";
export * from "./telemetry.js";

const ALL_ENVELOPES = [
  ...SESSION_ENVELOPES,
  ...CONTROL_ENVELOPES,
  ...EXECUTION_ENVELOPES,
  ...ARTIFACT_ENVELOPES,
  ...TELEMETRY_ENVELOPES,
] as const;

/**
 * Discriminated union of every core ARCP envelope. Use this to validate an
 * inbound message after it has been parsed from JSON; failures indicate
 * either an unknown `type` or a malformed payload.
 */
type EnvelopeElement = (typeof ALL_ENVELOPES)[number];
export const EnvelopeSchema = z.discriminatedUnion(
  "type",
  ALL_ENVELOPES as readonly [EnvelopeElement, ...EnvelopeElement[]],
);

export type Envelope = z.infer<typeof EnvelopeSchema>;
