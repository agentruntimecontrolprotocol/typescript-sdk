/**
 * Effect-shape integration for `@agentruntimecontrolprotocol/middleware-otel`.
 *
 * Slice #49 of the Effect migration. This module sits alongside the legacy
 * Transport-level {@link withTracing} wrapper (preserved unchanged in
 * `./index.ts`) and exposes a small, compositional bridge from
 * `@effect/opentelemetry` into an ARCP runtime built with
 * {@link makeARCPServerRuntime} / {@link ARCPRuntimeLayer}.
 *
 * Scope of this module
 * --------------------
 * Two distinct concerns are at play:
 *
 *   1. **Wire-level propagation.** Stamping the W3C `traceparent` carrier
 *      into `envelope.extensions["x-vendor.opentelemetry.tracecontext"]` so
 *      that ARCP §11 spans link across hops. That contract is owned by
 *      {@link withTracing} (Transport wrapper) and is unchanged.
 *
 *   2. **Effect-workflow tracing.** Letting spans opened by `Effect.withSpan`
 *      and `Effect.useSpan` inside an ARCP runtime appear in the same OTel
 *      trace as the spans emitted by (1). That is what this module adds.
 *
 * Why we don't expose a `NodeSdk.layer` here
 * ------------------------------------------
 * `@effect/opentelemetry`'s `NodeSdk.layer` constructs a full Node tracer
 * provider from `@opentelemetry/sdk-trace-node`, `@opentelemetry/resources`,
 * and a user-supplied `SpanProcessor`. That decision (which exporter, which
 * batching strategy, which propagator, etc.) belongs to the consumer's
 * observability stack, not to a middleware package. Forcing a particular
 * SDK shape would also force a hard dependency on `@opentelemetry/sdk-node`
 * — which the issue explicitly forbids ("No new dependency on
 * `@opentelemetry/sdk-node`; consumer brings their own SDK; we only bridge").
 *
 * Instead we expose {@link OtelTracerLayer}, a thin bridge that takes an
 * already-constructed OTel `TracerProvider` (whatever the consumer wired up
 * — `NodeTracerProvider`, `WebTracerProvider`, `@vercel/otel`, a no-op
 * provider for tests, or `trace.getTracerProvider()` after global registration)
 * and lifts it into an Effect {@link Layer} that satisfies the
 * `OtelTracer.OtelTracer` and `OtelTracer.OtelTracerProvider` requirements
 * for any downstream effect that calls `Effect.withSpan(...)`.
 *
 * Usage
 * -----
 * ```ts
 * import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
 * import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
 * import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
 * import { Layer } from "effect";
 * import { ARCPRuntimeLayer } from "@agentruntimecontrolprotocol/runtime";
 * import { OtelTracerLayer } from "@agentruntimecontrolprotocol/middleware-otel";
 *
 * const provider = new NodeTracerProvider();
 * provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()));
 * provider.register(); // also makes withTracing happy for §11 propagation
 *
 * const MainLayer = Layer.provideMerge(
 *   ARCPRuntimeLayer(serverOptions),
 *   OtelTracerLayer({
 *     tracerProvider: provider,
 *     resource: { serviceName: "arcp-runtime" },
 *   }),
 * );
 * ```
 *
 * The legacy {@link withTracing} wrapper continues to work side-by-side: it
 * pulls the active OTel context from `@opentelemetry/api` (which the global
 * provider above satisfies), so a single registered provider feeds both the
 * Transport-level `arcp.send` / `arcp.recv` spans and the Effect-workflow
 * spans opened inside the runtime.
 */
import * as OtelResource from "@effect/opentelemetry/Resource";
import * as OtelTracer from "@effect/opentelemetry/Tracer";
import type * as OtelApi from "@opentelemetry/api";
import { Layer } from "effect";

/**
 * Configuration for {@link OtelTracerLayer}.
 *
 * Both fields are required: the bridge needs a real OTel `TracerProvider`
 * to delegate span creation to, and a `resource` (service name / version /
 * attributes) so that `provider.getTracer(serviceName, serviceVersion)`
 * resolves to a stable tracer per the OTel spec.
 */
export interface OtelTracerLayerOptions {
  /**
   * The OpenTelemetry `TracerProvider` to bridge into Effect. Typically the
   * same provider passed to `provider.register()` so that the legacy
   * {@link withTracing} Transport wrapper (which reads from the global API)
   * and Effect-workflow spans share a single export pipeline.
   */
  readonly tracerProvider: OtelApi.TracerProvider;

  /**
   * Resource attributes used to name the bridged tracer. `serviceName` is
   * required; `serviceVersion` and `attributes` are optional and forwarded
   * to `@effect/opentelemetry`'s `Resource.layer` unchanged.
   */
  readonly resource: {
    readonly serviceName: string;
    readonly serviceVersion?: string;
    readonly attributes?: OtelApi.Attributes;
  };
}

/**
 * Build an Effect {@link Layer} that bridges Effect's tracer to a
 * consumer-supplied OTel `TracerProvider`.
 *
 * The resulting layer eliminates the `OtelTracer.OtelTracer`,
 * `OtelTracer.OtelTracerProvider`, and `OtelResource.Resource`
 * requirements for downstream effects, and replaces the default
 * Effect tracer with one that emits OTel spans through the supplied
 * provider. Compose it via `Layer.provideMerge` into an
 * `ARCPRuntimeLayer`-built program; no other plumbing is required.
 *
 * This is purely an Effect-shape addition. The Transport-level
 * `withTracing` wrapper exported from `./index.ts` is unchanged and
 * continues to be the right tool for §11 wire propagation.
 */
export const OtelTracerLayer = (
  options: OtelTracerLayerOptions,
): Layer.Layer<never> => {
  const providerLayer = Layer.succeed(
    OtelTracer.OtelTracerProvider,
    options.tracerProvider,
  );
  const resourceLayer = OtelResource.layer(options.resource);
  const tracerLayer = OtelTracer.layer;
  return Layer.provide(tracerLayer, Layer.merge(providerLayer, resourceLayer));
};
