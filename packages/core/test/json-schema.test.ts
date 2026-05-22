import { describe, expect, it } from "vitest";

import { validateAgainstSchema } from "@agentruntimecontrolprotocol/core/util";

describe("validateAgainstSchema (JSON-Schema subset)", () => {
  it("returns no errors for an empty schema", () => {
    expect(validateAgainstSchema(42, {})).toEqual([]);
  });

  it("validates type=string", () => {
    expect(validateAgainstSchema("x", { type: "string" })).toEqual([]);
    expect(validateAgainstSchema(42, { type: "string" })).toHaveLength(1);
  });

  it("validates type=number/integer", () => {
    expect(validateAgainstSchema(1.5, { type: "number" })).toEqual([]);
    expect(validateAgainstSchema(1.5, { type: "integer" })).toHaveLength(1);
    expect(validateAgainstSchema(1, { type: "integer" })).toEqual([]);
    expect(validateAgainstSchema(Number.NaN, { type: "number" })).toHaveLength(
      1,
    );
  });

  it("validates type=boolean", () => {
    expect(validateAgainstSchema(true, { type: "boolean" })).toEqual([]);
    expect(validateAgainstSchema("true", { type: "boolean" })).toHaveLength(1);
  });

  it("validates type=array", () => {
    expect(validateAgainstSchema([], { type: "array" })).toEqual([]);
    expect(validateAgainstSchema({}, { type: "array" })).toHaveLength(1);
  });

  it("validates type=object", () => {
    expect(validateAgainstSchema({}, { type: "object" })).toEqual([]);
    expect(validateAgainstSchema([], { type: "object" })).toHaveLength(1);
  });

  it("validates type=null", () => {
    expect(validateAgainstSchema(null, { type: "null" })).toEqual([]);
    expect(validateAgainstSchema(undefined, { type: "null" })).toHaveLength(1);
  });

  it("validates string length", () => {
    expect(
      validateAgainstSchema("ab", {
        type: "string",
        minLength: 1,
        maxLength: 4,
      }),
    ).toEqual([]);
    expect(
      validateAgainstSchema("", { type: "string", minLength: 1 }),
    ).toHaveLength(1);
    expect(
      validateAgainstSchema("xxxxx", { type: "string", maxLength: 3 }),
    ).toHaveLength(1);
  });

  it("validates number bounds", () => {
    expect(
      validateAgainstSchema(5, { type: "number", minimum: 1, maximum: 10 }),
    ).toEqual([]);
    expect(
      validateAgainstSchema(-1, { type: "number", minimum: 0 }),
    ).toHaveLength(1);
    expect(
      validateAgainstSchema(99, { type: "number", maximum: 10 }),
    ).toHaveLength(1);
  });

  it("validates required object properties", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    };
    expect(validateAgainstSchema({ a: "x" }, schema)).toEqual([]);
    expect(validateAgainstSchema({}, schema)).toHaveLength(1);
  });

  it("validates nested properties", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: { inner: { type: "string", minLength: 2 } },
          required: ["inner"],
        },
      },
      required: ["outer"],
    };
    expect(validateAgainstSchema({ outer: { inner: "ok" } }, schema)).toEqual(
      [],
    );
    expect(
      validateAgainstSchema({ outer: { inner: "x" } }, schema),
    ).toHaveLength(1);
    expect(validateAgainstSchema({ outer: {} }, schema)).toHaveLength(1);
  });

  it("validates array items", () => {
    const schema = { type: "array", items: { type: "number" } };
    expect(validateAgainstSchema([1, 2, 3], schema)).toEqual([]);
    expect(validateAgainstSchema([1, "two", 3], schema)).toHaveLength(1);
  });

  it("validates enum", () => {
    const schema = { enum: ["red", "green", "blue"] };
    expect(validateAgainstSchema("red", schema)).toEqual([]);
    expect(validateAgainstSchema("orange", schema)).toHaveLength(1);
  });

  it("returns an error for unknown type permissively (no error since permissive)", () => {
    expect(validateAgainstSchema(123, { type: "weird" })).toEqual([]);
  });

  it("undefined or null schema is treated as accept-all", () => {
    expect(validateAgainstSchema(123, undefined)).toEqual([]);
  });

  it("compound: object with properties + arrays + enums", () => {
    const schema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
        count: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["tags"],
    };
    expect(
      validateAgainstSchema({ tags: ["a", "b"], count: 1 }, schema),
    ).toEqual([]);
    expect(
      validateAgainstSchema({ tags: ["c"], count: 1 }, schema).length,
    ).toBeGreaterThan(0);
    expect(validateAgainstSchema({ count: 5 }, schema).length).toBeGreaterThan(
      0,
    );
  });
});
