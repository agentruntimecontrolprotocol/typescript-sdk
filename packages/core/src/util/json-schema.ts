/**
 * Minimal JSON-Schema (Draft 7 subset) validator for `human.input.request`
 * response validation (§12.1).
 *
 * @see PLAN.md §4 open question 2.
 *
 * Supported keywords:
 *   - `type`: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null"
 *   - `properties`, `required` (for object)
 *   - `items` (for array)
 *   - `minLength`, `maxLength` (for string)
 *   - `minimum`, `maximum` (for number/integer)
 *   - `enum`
 *
 * Other keywords (anyOf, allOf, $ref, format, pattern, ...) are accepted but
 * not enforced. Implementations needing stricter validation should delegate
 * to a real JSON-Schema engine after the request leaves this layer.
 */

import type { ValidationError } from "./types.js";

type SchemaNode = Record<string, unknown> | undefined;

/**
 * Validate `value` against `schema`. Returns an array of errors; empty means
 * valid. The `schema` is treated permissively: unknown keywords are ignored.
 */
interface ValidationFrame {
  value: unknown;
  schema: Record<string, unknown>;
  path: string;
}

export function validateAgainstSchema(
  value: unknown,
  schema: SchemaNode,
  path = "",
): ValidationError[] {
  // Defensive: schema can be null/undefined at runtime even though the type
  // says `SchemaNode` — callers may pass parsed JSON.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (schema === undefined || schema === null) return [];
  const frame: ValidationFrame = { value, schema, path };
  const errors: ValidationError[] = [];
  pushEnumError(errors, frame);
  const type = schema["type"];
  if (typeof type === "string" && !matchesType(value, type)) {
    errors.push({ path, message: `expected type "${type}"` });
    return errors;
  }
  pushStringErrors(errors, frame, type);
  pushNumberErrors(errors, frame, type);
  pushArrayErrors(errors, frame, type);
  pushObjectErrors(errors, frame, type);
  return errors;
}

function pushEnumError(
  errors: ValidationError[],
  { value, schema, path }: ValidationFrame,
): void {
  const enumValues = schema["enum"];
  if (!Array.isArray(enumValues)) return;
  if (enumValues.some((opt) => deepEqual(opt, value))) return;
  errors.push({ path, message: "value is not in enum" });
}

function pushStringErrors(
  errors: ValidationError[],
  { value, schema, path }: ValidationFrame,
  type: unknown,
): void {
  if (type !== "string" || typeof value !== "string") return;
  const minLen = schema["minLength"];
  const maxLen = schema["maxLength"];
  if (typeof minLen === "number" && value.length < minLen) {
    errors.push({ path, message: `string shorter than minLength=${minLen}` });
  }
  if (typeof maxLen === "number" && value.length > maxLen) {
    errors.push({ path, message: `string longer than maxLength=${maxLen}` });
  }
}

function pushNumberErrors(
  errors: ValidationError[],
  { value, schema, path }: ValidationFrame,
  type: unknown,
): void {
  if (type !== "number" && type !== "integer") return;
  if (typeof value !== "number") return;
  const minimum = schema["minimum"];
  const maximum = schema["maximum"];
  if (typeof minimum === "number" && value < minimum) {
    errors.push({ path, message: `number below minimum=${minimum}` });
  }
  if (typeof maximum === "number" && value > maximum) {
    errors.push({ path, message: `number above maximum=${maximum}` });
  }
}

function pushArrayErrors(
  errors: ValidationError[],
  { value, schema, path }: ValidationFrame,
  type: unknown,
): void {
  if (type !== "array" || !Array.isArray(value)) return;
  const items = schema["items"];
  if (items === undefined || typeof items !== "object" || items === null) return;
  for (const [idx, item] of value.entries()) {
    errors.push(
      ...validateAgainstSchema(
        item,
        items as Record<string, unknown>,
        `${path}[${idx}]`,
      ),
    );
  }
}

function pushObjectErrors(
  errors: ValidationError[],
  frame: ValidationFrame,
  type: unknown,
): void {
  if (type !== "object" || !isPlainObject(frame.value)) return;
  const objFrame: ObjectFrame = {
    value: frame.value,
    schema: frame.schema,
    path: frame.path,
  };
  pushRequiredErrors(errors, objFrame);
  pushPropertyErrors(errors, objFrame);
}

interface ObjectFrame {
  value: Record<string, unknown>;
  schema: Record<string, unknown>;
  path: string;
}

function pushRequiredErrors(
  errors: ValidationError[],
  { value, schema, path }: ObjectFrame,
): void {
  const required = schema["required"];
  if (!Array.isArray(required)) return;
  for (const key of required) {
    if (typeof key === "string" && !(key in value)) {
      errors.push({
        path: joinPath(path, key),
        message: "required property missing",
      });
    }
  }
}

function pushPropertyErrors(
  errors: ValidationError[],
  { value, schema, path }: ObjectFrame,
): void {
  const properties = schema["properties"];
  if (properties === undefined || !isPlainObject(properties)) return;
  for (const [key, propSchema] of Object.entries(properties)) {
    if (key in value) {
      errors.push(
        ...validateAgainstSchema(
          value[key],
          propSchema as Record<string, unknown>,
          joinPath(path, key),
        ),
      );
    }
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": {
      return typeof value === "string";
    }
    case "number": {
      return typeof value === "number" && Number.isFinite(value);
    }
    case "integer": {
      return typeof value === "number" && Number.isInteger(value);
    }
    case "boolean": {
      return typeof value === "boolean";
    }
    case "array": {
      return Array.isArray(value);
    }
    case "object": {
      return isPlainObject(value);
    }
    case "null": {
      return value === null;
    }
    default: {
      return true;
    } // unknown types are permissive
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a).toSorted();
    const bk = Object.keys(b).toSorted();
    if (ak.length !== bk.length) return false;
    return ak.every((k, i) => k === bk[i] && deepEqual(a[k], b[k]));
  }
  return false;
}
