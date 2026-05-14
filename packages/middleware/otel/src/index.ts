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

const OTEL_EXTENSION_NAME = "x.otel" as const;

export interface WithTracingOptions {
  /**
   * Tracer used to start spans. Required so the consumer controls the
   * service name and tracer provider.
   */
  tracer: Tracer;

  /**
   * Override the span name for outbound frames. Default:
   * `` `arcp.send ${envelope.type}` ``.
   */
  sendSpanName?: (envelope: BaseEnvelope | WireFrame) => string;

  /**
   * Override the span name for inbound frames. Default:
   * `` `arcp.recv ${frame.type}` ``.
   */
  recvSpanName?: (frame: WireFrame) => string;
}

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
  const { tracer } = options;

  return {
    get closed() {
      return inner.closed;
    },

    async send(frame: SendableFrame): Promise<void> {
      const type =
        typeof (frame as { type?: unknown }).type === "string"
          ? (frame as { type: string }).type
          : "unknown";
      const spanName = options.sendSpanName?.(frame) ?? `arcp.send ${type}`;

      const span = tracer.startSpan(spanName, {
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
      } catch (err) {
        recordError(span, err);
        throw err;
      } finally {
        span.end();
      }
    },

    onFrame(handler: FrameHandler): void {
      inner.onFrame(async (frame) => {
        const carrier = extractExtension(frame);
        const parent =
          carrier !== undefined
            ? propagation.extract(context.active(), carrier)
            : context.active();

        const type =
          typeof frame["type"] === "string"
            ? (frame["type"] as string)
            : "unknown";
        const spanName = options.recvSpanName?.(frame) ?? `arcp.recv ${type}`;

        const span = tracer.startSpan(
          spanName,
          {
            kind: SpanKind.CONSUMER,
            attributes: extractAttributes(frame, "in"),
          },
          parent,
        );

        try {
          await context.with(trace.setSpan(parent, span), () => handler(frame));
        } catch (err) {
          recordError(span, err);
          throw err;
        } finally {
          span.end();
        }
      });
    },

    onClose(handler: (err?: Error) => void): void {
      inner.onClose(handler);
    },

    close(reason?: string): Promise<void> {
      return inner.close(reason);
    },
  };
}

function extractAttributes(
  frame: BaseEnvelope | WireFrame,
  direction: "in" | "out",
): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    "arcp.direction": direction,
  };
  const obj = frame as Record<string, unknown>;
  if (typeof obj["type"] === "string") attrs["arcp.type"] = obj["type"];
  if (typeof obj["id"] === "string") attrs["arcp.id"] = obj["id"];
  if (typeof obj["session_id"] === "string")
    attrs["arcp.session_id"] = obj["session_id"];
  if (typeof obj["job_id"] === "string") attrs["arcp.job_id"] = obj["job_id"];
  if (typeof obj["trace_id"] === "string")
    attrs["arcp.trace_id"] = obj["trace_id"];
  if (typeof obj["event_seq"] === "number")
    attrs["arcp.event_seq"] = obj["event_seq"];
  // For job.submit / job.accepted, surface agent and lease capabilities.
  const payload = obj["payload"];
  if (typeof payload === "object" && payload !== null) {
    const p = payload as Record<string, unknown>;
    if (typeof p["agent"] === "string") attrs["arcp.agent"] = p["agent"];
    const lease = p["lease"] ?? p["lease_request"];
    if (typeof lease === "object" && lease !== null) {
      const caps = Object.keys(lease as Record<string, unknown>);
      if (caps.length > 0) attrs["arcp.lease.capabilities"] = caps.join(",");
    }
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
  } as SendableFrame;
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
