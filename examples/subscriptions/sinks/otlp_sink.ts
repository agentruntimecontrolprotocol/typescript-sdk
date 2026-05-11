/** OTLP exporter for `metric` and `trace.span` envelopes (RFC §17). */
import type { BaseEnvelope } from "../../../src/index.js";

export class OTLPSink {
  private readonly endpoint: string;

  public constructor(opts: { endpoint: string }) {
    this.endpoint = opts.endpoint;
    // Real version: @opentelemetry/exporter-trace-otlp-http +
    // meter/tracer providers wired here.
  }

  public async handle(env: BaseEnvelope): Promise<void> {
    void this.endpoint;
    switch (env.type) {
      case "metric":
        // Standard names (§17.3.1): tokens.used, cost.usd, latency.ms, ...
        throw new Error("not implemented");
      case "trace.span":
        // `trace.span` mirrors OpenTelemetry's span shape.
        throw new Error("not implemented");
      default:
        return;
    }
  }
}
