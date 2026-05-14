import type { BaseEnvelope } from "@arcp/core/envelope";
import type { WireFrame } from "@arcp/core/transport";
import type { Tracer } from "@opentelemetry/api";

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
