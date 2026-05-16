import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fromZod } from "@arcp/core";

// `fromZod()` is the one-call bridge used by remaining zod-typed call-sites
// (events.ts `RESERVED_EVENT_SCHEMAS`) during the Effect migration. The
// tests pin the bridge's parse-success / parse-failure semantics so the
// behavior stays stable across slices #36/#37/#50.

describe("fromZod()", () => {
  it("decodes a value that the underlying zod schema accepts", async () => {
    const ZodShape = z.object({ name: z.string().min(1), age: z.number() });
    const bridged = fromZod(ZodShape);
    const out = await Effect.runPromise(
      Schema.decodeUnknown(bridged)({ name: "ada", age: 36 }),
    );
    expect(out).toEqual({ name: "ada", age: 36 });
  });

  it("fails the Effect channel when the zod schema rejects", async () => {
    const ZodShape = z.object({ name: z.string().min(1) });
    const bridged = fromZod(ZodShape);
    await expect(
      Effect.runPromise(Schema.decodeUnknown(bridged)({ name: "" })),
    ).rejects.toThrow();
  });

  it("surfaces zod issue messages via ParseError", async () => {
    const ZodShape = z.object({ a: z.string() });
    const bridged = fromZod(ZodShape);
    await expect(
      Effect.runPromise(Schema.decodeUnknown(bridged)({ a: 7 })),
    ).rejects.toThrow(/Expected string/);
  });
});
