/**
 * Aggregate registry of every core message type defined by ARCP v1.0/v1.1.
 *
 * `EnvelopeSchema` is the discriminated union over `type` (Effect Schema).
 * Parsing an inbound envelope through this schema yields a fully-typed
 * envelope value or a `ParseError` on unknown/invalid types.
 */
import { Schema } from "effect";

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
export type * from "./types.js";

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
export const EnvelopeSchema = Schema.Union(
  ...(ALL_ENVELOPES as readonly [EnvelopeElement, ...EnvelopeElement[]]),
);

export type Envelope = Schema.Schema.Type<typeof EnvelopeSchema>;
