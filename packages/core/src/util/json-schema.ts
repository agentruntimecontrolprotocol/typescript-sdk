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

export interface ValidationError {
  path: string;
  message: string;
}

type SchemaNode = Record<string, unknown> | undefined;

/**
 * Validate `value` against `schema`. Returns an array of errors; empty means
 * valid. The `schema` is treated permissively: unknown keywords are ignored.
 */
export function validateAgainstSchema(
  value: unknown,
  schema: SchemaNode,
  path: string = "",
): ValidationError[] {
  if (schema === undefined || schema === null) return [];
  const errors: ValidationError[] = [];

  const enumValues = schema["enum"];
  if (Array.isArray(enumValues)) {
    if (!enumValues.some((opt) => deepEqual(opt, value))) {
      errors.push({ path, message: "value is not in enum" });
    }
  }

  const type = schema["type"];
  if (typeof type === "string") {
    if (!matchesType(value, type)) {
      errors.push({ path, message: `expected type "${type}"` });
      return errors; // further checks would not be meaningful
    }
  }

  if (type === "string" && typeof value === "string") {
    const minLen = schema["minLength"];
    const maxLen = schema["maxLength"];
    if (typeof minLen === "number" && value.length < minLen) {
      errors.push({ path, message: `string shorter than minLength=${minLen}` });
    }
    if (typeof maxLen === "number" && value.length > maxLen) {
      errors.push({ path, message: `string longer than maxLength=${maxLen}` });
    }
  }

  if ((type === "number" || type === "integer") && typeof value === "number") {
    const minimum = schema["minimum"];
    const maximum = schema["maximum"];
    if (typeof minimum === "number" && value < minimum) {
      errors.push({ path, message: `number below minimum=${minimum}` });
    }
    if (typeof maximum === "number" && value > maximum) {
      errors.push({ path, message: `number above maximum=${maximum}` });
    }
  }

  if (type === "array" && Array.isArray(value)) {
    const items = schema["items"];
    if (items !== undefined && typeof items === "object" && items !== null) {
      value.forEach((item, idx) => {
        errors.push(
          ...validateAgainstSchema(
            item,
            items as Record<string, unknown>,
            `${path}[${idx}]`,
          ),
        );
      });
    }
  }

  if (type === "object" && isPlainObject(value)) {
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) {
          errors.push({
            path: joinPath(path, key),
            message: "required property missing",
          });
        }
      }
    }
    const properties = schema["properties"];
    if (properties !== undefined && isPlainObject(properties)) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in value) {
          errors.push(
            ...validateAgainstSchema(
              (value as Record<string, unknown>)[key],
              propSchema as Record<string, unknown>,
              joinPath(path, key),
            ),
          );
        }
      }
    }
  }

  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    default:
      return true; // unknown types are permissive
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
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    return ak.every((k, i) => k === bk[i] && deepEqual(a[k], b[k]));
  }
  return false;
}
