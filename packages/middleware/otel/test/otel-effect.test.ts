// Behavior + smoke coverage for `otel-effect.ts`. These tests stay scoped
// to the middleware package by driving `OtelTracerLayer` against an
// in-memory `BasicTracerProvider` + `InMemorySpanExporter` from
// `@opentelemetry/sdk-trace-base`. We assert:
//
//   1) `OtelTracerLayer` is a valid Effect Layer with no leftover
//      requirements (smoke test — proves the bridge can be composed into
//      `ARCPRuntimeLayer` without further plumbing).
//   2) Spans opened via `Effect.withSpan` inside the resulting program are
//      exported through the consumer-supplied `TracerProvider`, with the
//      configured `serviceName` recorded on the tracer and the expected
//      parent/child structure preserved (the §11 acceptance scenario,
//      reduced to a single Effect-shape workflow).
//   3) The legacy `withTracing` re-export still works (regression guard
//      for the published surface — no behavior change).

import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  BasicTracerProvider,
} from "@opentelemetry/sdk-trace-base";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { OtelTracerLayer, withTracing } from "../src/index.js";

describe("OtelTracerLayer", () => {
  it("composes into a runnable program with no leftover requirements", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const layer = OtelTracerLayer({
      tracerProvider: provider,
      resource: { serviceName: "arcp-runtime-test" },
    });

    // If the layer leaves any requirements the type-system would already
    // have failed; this provideLayer call is the runtime smoke-test.
    const program = Effect.succeed("ok").pipe(
      Effect.withSpan("smoke"),
      Effect.provide(layer),
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");

    await provider.shutdown();
  });

  it("exports Effect spans through the supplied OTel TracerProvider with the configured serviceName", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const layer = OtelTracerLayer({
      tracerProvider: provider,
      resource: {
        serviceName: "arcp-runtime",
        serviceVersion: "0.1.0",
      },
    });

    // session.handshake → job.submit → handler (per #49 acceptance shape,
    // reduced to a single Effect workflow — wire-level propagation across
    // session boundaries is covered by `withTracing` and is out of scope
    // for this Effect-shape bridge).
    const program = Effect.gen(function* () {
      yield* Effect.succeed(undefined).pipe(Effect.withSpan("job.submit"));
      yield* Effect.succeed(undefined).pipe(Effect.withSpan("handler"));
    }).pipe(Effect.withSpan("session.handshake"), Effect.provide(layer));

    await Effect.runPromise(program);

    // SimpleSpanProcessor flushes per-span synchronously, but force a
    // flush to be defensive against batching changes upstream.
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();

    const names = spans.map((s) => s.name).sort();
    expect(names).toEqual(["handler", "job.submit", "session.handshake"]);

    // Tracer name = serviceName (per @effect/opentelemetry's layerTracer);
    // assert the bridge actually delegated to provider.getTracer(...).
    for (const s of spans) {
      expect(s.instrumentationScope.name).toBe("arcp-runtime");
      expect(s.instrumentationScope.version).toBe("0.1.0");
    }

    // Verify the parent/child structure: session.handshake is the root,
    // and both job.submit and handler hang off it.
    const byName = new Map(spans.map((s) => [s.name, s]));
    const root = byName.get("session.handshake");
    const submit = byName.get("job.submit");
    const handler = byName.get("handler");
    expect(root?.parentSpanContext).toBeUndefined();
    expect(submit?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
    expect(handler?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);

    await provider.shutdown();
  });

  it("re-exports the legacy withTracing wrapper unchanged", () => {
    // Regression guard: this must not alter the published surface.
    // We only assert the export is a callable function — its
    // behavior is exercised by consumers (no tests previously existed
    // in this package).
    expect(typeof withTracing).toBe("function");
  });
});
