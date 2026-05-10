import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CORE_MESSAGE_TYPES,
  classifyUnknownType,
  ExtensionRegistry,
  InvalidArgumentError,
  isCoreType,
  isExtensionName,
  looksLikeCoreType,
  NotImplementedError,
  validateExtensionsObject,
} from "../../src/index.js";

describe("isExtensionName", () => {
  it("accepts canonical arcpx names", () => {
    expect(isExtensionName("arcpx.acme.workflow.v1")).toBe(true);
    expect(isExtensionName("arcpx.acme.workflow.v23")).toBe(true);
  });

  it("accepts reverse-DNS names", () => {
    expect(isExtensionName("com.acme.workflow.v2")).toBe(true);
    expect(isExtensionName("dev.fizzpop.thing.v1")).toBe(true);
  });

  it("rejects names without a version suffix", () => {
    expect(isExtensionName("arcpx.acme.thing")).toBe(false);
    expect(isExtensionName("com.acme.workflow")).toBe(false);
  });

  it("rejects names with too few segments", () => {
    expect(isExtensionName("foo.v1")).toBe(false);
  });

  it("rejects bare x- prefixed names", () => {
    expect(isExtensionName("x-experimental.feature.v1")).toBe(false);
  });

  it("rejects empty and whitespace strings", () => {
    expect(isExtensionName("")).toBe(false);
    expect(isExtensionName("   ")).toBe(false);
  });
});

describe("isCoreType / CORE_MESSAGE_TYPES", () => {
  it("contains every type group from §6.2", () => {
    // Sample one from each group
    const samples = [
      "session.open",
      "ping",
      "ack",
      "tool.invoke",
      "job.accepted",
      "stream.open",
      "human.input.request",
      "permission.request",
      "lease.granted",
      "subscribe",
      "artifact.put",
      "event.emit",
      "log",
      "metric",
      "trace.span",
    ];
    for (const t of samples) expect(CORE_MESSAGE_TYPES).toContain(t);
  });

  it("isCoreType returns true for closed-set members", () => {
    expect(isCoreType("session.open")).toBe(true);
    expect(isCoreType("subscribe")).toBe(true);
  });

  it("isCoreType returns false for unknown types", () => {
    expect(isCoreType("session.banana")).toBe(false);
  });
});

describe("looksLikeCoreType", () => {
  it("matches close variants of core types", () => {
    expect(looksLikeCoreType("session.banana")).toBe(true);
    expect(looksLikeCoreType("tool.weird")).toBe(true);
    expect(looksLikeCoreType("checkpoint.foo")).toBe(true);
  });

  it("does not match extension names", () => {
    expect(looksLikeCoreType("arcpx.acme.thing.v1")).toBe(false);
    expect(looksLikeCoreType("com.example.foo.v2")).toBe(false);
  });
});

describe("classifyUnknownType (§21.3)", () => {
  it("nacks unknown core-prefixed types", () => {
    const d = classifyUnknownType("session.frobnicate");
    expect(d.kind).toBe("nack");
    if (d.kind === "nack") expect(d.code).toBe("UNIMPLEMENTED");
  });

  it("drops optional namespaced types when extensions.optional=true", () => {
    const d = classifyUnknownType("arcpx.acme.thing.v1", {
      extensionsObject: { optional: true },
    });
    expect(d.kind).toBe("drop");
  });

  it("nacks namespaced types when not flagged optional", () => {
    const d = classifyUnknownType("arcpx.acme.thing.v1");
    expect(d.kind).toBe("nack");
  });

  it("nacks junk that matches neither core nor extension", () => {
    const d = classifyUnknownType("totally_random");
    expect(d.kind).toBe("nack");
  });
});

describe("validateExtensionsObject", () => {
  it("accepts empty object", () => {
    expect(() => validateExtensionsObject({})).not.toThrow();
  });

  it("accepts the bare 'optional' key", () => {
    expect(() => validateExtensionsObject({ optional: true })).not.toThrow();
  });

  it("accepts properly namespaced keys", () => {
    expect(() =>
      validateExtensionsObject({
        "arcpx.acme.thing.v1": { ok: true },
        optional: false,
      }),
    ).not.toThrow();
  });

  it("rejects bare keys other than 'optional'", () => {
    expect(() => validateExtensionsObject({ foo: 1 })).toThrow(InvalidArgumentError);
  });

  it("rejects x- prefixed keys", () => {
    expect(() => validateExtensionsObject({ "x-foo": 1 })).toThrow(InvalidArgumentError);
  });
});

describe("ExtensionRegistry", () => {
  it("starts empty", () => {
    const r = new ExtensionRegistry();
    expect(r.list()).toEqual([]);
    expect(r.has("arcpx.acme.thing.v1")).toBe(false);
  });

  it("registers and lists names", () => {
    const r = new ExtensionRegistry();
    r.register("arcpx.acme.thing.v1", z.object({ value: z.number() }));
    expect(r.has("arcpx.acme.thing.v1")).toBe(true);
    expect(r.list()).toContain("arcpx.acme.thing.v1");
  });

  it("rejects registration of invalid namespaces", () => {
    const r = new ExtensionRegistry();
    expect(() => r.register("not-namespaced", z.unknown())).toThrow(InvalidArgumentError);
    expect(() => r.register("session.invented", z.unknown())).toThrow(InvalidArgumentError);
  });

  it("parses payloads against the registered schema", () => {
    const r = new ExtensionRegistry();
    r.register("arcpx.acme.thing.v1", z.object({ value: z.number() }));
    const out = r.parse<{ value: number }>("arcpx.acme.thing.v1", { value: 42 });
    expect(out.value).toBe(42);
  });

  it("throws NotImplementedError for unknown extensions", () => {
    const r = new ExtensionRegistry();
    expect(() => r.parse("arcpx.acme.unknown.v1", {})).toThrow(NotImplementedError);
  });

  it("propagates schema errors for bad payloads", () => {
    const r = new ExtensionRegistry();
    r.register("arcpx.acme.thing.v1", z.object({ value: z.number() }));
    expect(() => r.parse("arcpx.acme.thing.v1", { value: "not-a-number" })).toThrow();
  });

  it("supports unregister", () => {
    const r = new ExtensionRegistry();
    r.register("arcpx.acme.thing.v1", z.unknown());
    expect(r.unregister("arcpx.acme.thing.v1")).toBe(true);
    expect(r.has("arcpx.acme.thing.v1")).toBe(false);
    expect(r.unregister("arcpx.acme.thing.v1")).toBe(false);
  });
});
