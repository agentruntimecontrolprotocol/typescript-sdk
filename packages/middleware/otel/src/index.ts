/**
 * @arcp/middleware-otel — OpenTelemetry tracing middleware for ARCP.
 *
 * The seam ARCP exposes is the {@link Transport} interface. This package
 * wraps any transport so that:
 *
 *   - Outbound `send` calls produce a `arcp.send` span with the envelope
 *     type/id/session_id as attributes, and the active trace context is
 *     injected into the envelope's `extensions["x.otel"]` field (W3C
 *     traceparent + tracestate) so the peer can continue the trace.
 *   - Inbound frames produce a `arcp.recv` span, extracting any
 *     `extensions["x.otel"]` trace context so the inbound frame appears
 *     as a child of the originating span on the remote end.
 *
 * Wire it on either side:
 * ```ts
 * import { trace } from "@opentelemetry/api";
 * import { withTracing } from "@arcp/middleware-otel";
 *
 * const tracer = trace.getTracer("my-arcp-runtime");
 * const traced = withTracing(rawTransport, { tracer });
 * server.accept(traced); // or client.connect(traced);
 * ```
 */
import type { BaseEnvelope } from "@arcp/core/envelope";
import type {
  FrameHandler,
  SendableFrame,
  Transport,
  WireFrame,
} from "@arcp/core/transport";
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";

import type { WithTracingOptions } from "./types.js";

export type { WithTracingOptions } from "./types.js";

// Per ARCP §15 (IANA / extension namespace), all envelope extensions must be
// in the `x-vendor.<vendor>.<name>` namespace. The OTel propagation carrier
// rides under the OpenTelemetry vendor key.
const OTEL_EXTENSION_NAME = "x-vendor.opentelemetry.tracecontext" as const;

/**
 * Wrap a {@link Transport} so each frame produces a span and W3C trace
 * context is propagated through `envelope.extensions["x.otel"]`.
 *
 * The returned transport satisfies the same interface, so it is a drop-in
 * for `ARCPServer.accept(...)` / `ARCPClient.connect(...)`.
 */
export function withTracing(
  inner: Transport,
  options: WithTracingOptions,
): Transport {
  return {
    get closed() {
      return inner.closed;
    },
    send: (frame) => sendWithSpan(inner, options, frame),
    onFrame: (handler) => {
      inner.onFrame((frame) => recvWithSpan(options, frame, handler));
    },
    onClose: (handler) => {
      inner.onClose(handler);
    },
    close: (reason) => inner.close(reason),
  };
}

async function sendWithSpan(
  inner: Transport,
  options: WithTracingOptions,
  frame: SendableFrame,
): Promise<void> {
  const type = frameType(frame);
  const spanName = options.sendSpanName?.(frame) ?? `arcp.send ${type}`;
  const span = options.tracer.startSpan(spanName, {
    kind: SpanKind.PRODUCER,
    attributes: extractAttributes(frame, "out"),
  });
  const carrier: Record<string, string> = {};
  propagation.inject(trace.setSpan(context.active(), span), carrier);
  const enriched = injectExtension(frame, carrier);
  try {
    await context.with(trace.setSpan(context.active(), span), () =>
      inner.send(enriched),
    );
  } catch (error) {
    recordError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

async function recvWithSpan(
  options: WithTracingOptions,
  frame: WireFrame,
  handler: FrameHandler,
): Promise<void> {
  const carrier = extractExtension(frame);
  const parent =
    carrier === undefined
      ? context.active()
      : propagation.extract(context.active(), carrier);
  const type = frameType(frame);
  const spanName = options.recvSpanName?.(frame) ?? `arcp.recv ${type}`;
  const span = options.tracer.startSpan(
    spanName,
    {
      kind: SpanKind.CONSUMER,
      attributes: extractAttributes(frame, "in"),
    },
    parent,
  );
  try {
    await context.with(trace.setSpan(parent, span), () => handler(frame));
  } catch (error) {
    recordError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

function frameType(frame: BaseEnvelope | WireFrame): string {
  const t = (frame as { type?: unknown }).type;
  return typeof t === "string" ? t : "unknown";
}

type AttrValue = string | number;

const ENVELOPE_FIELDS: readonly (readonly [
  string,
  string,
  "string" | "number",
])[] = [
  ["type", "arcp.type", "string"],
  ["id", "arcp.id", "string"],
  ["session_id", "arcp.session_id", "string"],
  ["job_id", "arcp.job_id", "string"],
  ["trace_id", "arcp.trace_id", "string"],
  ["event_seq", "arcp.event_seq", "number"],
];

function pickEnvelopeFields(
  attrs: Record<string, AttrValue>,
  obj: Record<string, unknown>,
): void {
  for (const [src, dst, kind] of ENVELOPE_FIELDS) {
    const v = obj[src];
    if (typeof v === kind) attrs[dst] = v as AttrValue;
  }
}

function pickLeaseAttributes(
  attrs: Record<string, AttrValue>,
  p: Record<string, unknown>,
): void {
  pickLeaseCapabilities(attrs, p["lease"] ?? p["lease_request"]);
  pickLeaseExpiry(attrs, p["lease_constraints"]);
  pickBudget(attrs, p["budget"]);
}

function pickLeaseCapabilities(
  attrs: Record<string, AttrValue>,
  lease: unknown,
): void {
  if (typeof lease !== "object" || lease === null) return;
  const caps = Object.keys(lease);
  if (caps.length > 0) attrs["arcp.lease.capabilities"] = caps.join(",");
}

function pickLeaseExpiry(
  attrs: Record<string, AttrValue>,
  constraints: unknown,
): void {
  if (typeof constraints !== "object" || constraints === null) return;
  const ea = (constraints as Record<string, unknown>)["expires_at"];
  if (typeof ea === "string") attrs["arcp.lease.expires_at"] = ea;
}

function pickBudget(attrs: Record<string, AttrValue>, budget: unknown): void {
  if (typeof budget !== "object" || budget === null) return;
  try {
    attrs["arcp.budget.remaining"] = JSON.stringify(budget);
  } catch {
    // best-effort serialization; non-serializable budgets are skipped.
  }
}

function extractAttributes(
  frame: BaseEnvelope | WireFrame,
  direction: "in" | "out",
): Record<string, AttrValue> {
  const attrs: Record<string, AttrValue> = { "arcp.direction": direction };
  const obj = frame as Record<string, unknown>;
  pickEnvelopeFields(attrs, obj);
  const payload = obj["payload"];
  if (typeof payload === "object" && payload !== null) {
    const p = payload as Record<string, unknown>;
    if (typeof p["agent"] === "string") attrs["arcp.agent"] = p["agent"];
    pickLeaseAttributes(attrs, p);
  }
  return attrs;
}

function injectExtension(
  frame: SendableFrame,
  carrier: Record<string, string>,
): SendableFrame {
  if (Object.keys(carrier).length === 0) return frame;
  const existing =
    (frame as { extensions?: Record<string, unknown> }).extensions ?? {};
  return {
    ...frame,
    extensions: { ...existing, [OTEL_EXTENSION_NAME]: carrier },
  };
}

function extractExtension(
  frame: WireFrame,
): Record<string, string> | undefined {
  const ext = frame["extensions"];
  if (typeof ext !== "object" || ext === null) return undefined;
  const otel = (ext as Record<string, unknown>)[OTEL_EXTENSION_NAME];
  if (typeof otel !== "object" || otel === null) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(otel as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function recordError(
  span: ReturnType<Tracer["startSpan"]>,
  err: unknown,
): void {
  if (err instanceof Error) span.recordException(err);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  });
}
