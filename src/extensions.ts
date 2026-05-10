import type { z } from "zod";
import { InvalidArgumentError, NotImplementedError } from "./errors.js";

/**
 * Pattern for an extension message type or extension envelope-field key.
 *
 * Per §21.1 the canonical forms are `arcpx.<vendor>.<name>.v<n>` or
 * a reverse-DNS prefix like `com.acme.workflow.v2`. The bare `x-` prefix
 * is reserved for transport-internal experimental fields and **MUST NOT**
 * appear in long-lived deployments (§21.1).
 *
 * The pattern enforces:
 *  - lowercase identifiers, dot-separated
 *  - at least two segments before the trailing version
 *  - trailing `.v<digits>` version suffix
 */
const EXTENSION_NAME_PATTERN = /^(?!x-)[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+){2,}\.v\d+$/;

/** Whether `name` is a syntactically valid extension namespace per §21.1. */
export function isExtensionName(name: string): boolean {
  return EXTENSION_NAME_PATTERN.test(name);
}

/**
 * Closed set of core message types defined by RFC 0001 §6.2.
 * Anything not in this set must either be an extension (validated against
 * {@link isExtensionName}) or rejected as unknown.
 */
export const CORE_MESSAGE_TYPES = [
  // Identity & Authentication
  "session.open",
  "session.challenge",
  "session.authenticate",
  "session.accepted",
  "session.unauthenticated",
  "session.rejected",
  "session.refresh",
  "session.evicted",
  "session.close",
  // Control
  "ping",
  "pong",
  "ack",
  "nack",
  "cancel",
  "cancel.accepted",
  "cancel.refused",
  "interrupt",
  "resume",
  "backpressure",
  "checkpoint.create",
  "checkpoint.restore",
  // Execution
  "tool.invoke",
  "tool.result",
  "tool.error",
  "job.accepted",
  "job.started",
  "job.progress",
  "job.heartbeat",
  "job.checkpoint",
  "job.completed",
  "job.failed",
  "job.cancelled",
  "job.schedule",
  "workflow.start",
  "workflow.complete",
  "agent.delegate",
  "agent.handoff",
  // Streaming
  "stream.open",
  "stream.chunk",
  "stream.close",
  "stream.error",
  // Human-in-the-Loop
  "human.input.request",
  "human.input.response",
  "human.choice.request",
  "human.choice.response",
  "human.input.cancelled",
  // Permissions & Leases
  "permission.request",
  "permission.grant",
  "permission.deny",
  "lease.granted",
  "lease.extended",
  "lease.revoked",
  "lease.refresh",
  // Subscriptions
  "subscribe",
  "subscribe.accepted",
  "subscribe.event",
  "unsubscribe",
  "subscribe.closed",
  // Artifacts
  "artifact.put",
  "artifact.fetch",
  "artifact.ref",
  "artifact.release",
  // Events & Telemetry
  "event.emit",
  "log",
  "metric",
  "trace.span",
] as const;

export type CoreMessageType = (typeof CORE_MESSAGE_TYPES)[number];

const CORE_TYPE_SET: ReadonlySet<string> = new Set(CORE_MESSAGE_TYPES);

/**
 * Core type *prefixes* used to detect when an unrecognized type is "trying"
 * to be a core type (e.g. `session.something_invalid`). Per §21.3 unknown
 * types matching a core prefix MUST be answered with `UNIMPLEMENTED`.
 */
const CORE_PREFIXES = [
  "session.",
  "ping",
  "pong",
  "ack",
  "nack",
  "cancel",
  "interrupt",
  "resume",
  "backpressure",
  "checkpoint.",
  "tool.",
  "job.",
  "workflow.",
  "agent.",
  "stream.",
  "human.",
  "permission.",
  "lease.",
  "subscribe",
  "unsubscribe",
  "artifact.",
  "event.",
  "log",
  "metric",
  "trace.",
] as const;

/** Whether `type` is one of the closed set of core types (§6.2). */
export function isCoreType(type: string): type is CoreMessageType {
  return CORE_TYPE_SET.has(type);
}

/** Whether `type` *looks like* a core type even if not in the closed set. */
export function looksLikeCoreType(type: string): boolean {
  if (CORE_TYPE_SET.has(type)) return true;
  return CORE_PREFIXES.some(
    (prefix) => type === prefix || (prefix.endsWith(".") && type.startsWith(prefix)),
  );
}

/** Disposition for an inbound message whose `type` is unknown to this receiver. */
export type UnknownTypeDisposition =
  | { kind: "drop"; reason: string }
  | { kind: "nack"; code: "UNIMPLEMENTED"; reason: string };

/**
 * Decide what to do when we receive an envelope with an unknown `type`.
 *
 * Per §21.3:
 *   - Unknown core-prefixed type → nack `UNIMPLEMENTED`.
 *   - Namespaced extension not advertised, sender flagged optional → silent drop.
 *   - Namespaced extension not advertised, no optional flag → nack `UNIMPLEMENTED`.
 *   - Anything that does not match a core prefix or extension namespace → nack.
 */
export function classifyUnknownType(
  type: string,
  options: { extensionsObject?: Record<string, unknown> | undefined } = {},
): UnknownTypeDisposition {
  if (looksLikeCoreType(type)) {
    return {
      kind: "nack",
      code: "UNIMPLEMENTED",
      reason: `Unknown core message type "${type}" (§21.3)`,
    };
  }
  if (isExtensionName(type)) {
    const optional = options.extensionsObject?.["optional"] === true;
    if (optional) {
      return { kind: "drop", reason: `Optional extension "${type}" not advertised (§21.3)` };
    }
    return {
      kind: "nack",
      code: "UNIMPLEMENTED",
      reason: `Required extension "${type}" not advertised (§21.3)`,
    };
  }
  return {
    kind: "nack",
    code: "UNIMPLEMENTED",
    reason: `Type "${type}" matches neither core nor extension namespace`,
  };
}

/**
 * Validates an envelope `extensions` object's keys.
 *
 * The reserved key `optional` is allowed bare. Every other key MUST be a
 * valid extension namespace per §21.1.
 */
export function validateExtensionsObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (key === "optional") continue;
    if (!isExtensionName(key)) {
      throw new InvalidArgumentError(`Extensions key "${key}" is not a valid namespace (§21.1)`, {
        details: { key },
      });
    }
  }
}

/**
 * Registry of extension message-type schemas.
 *
 * An extension provides a zod schema for its payload; the registry validates
 * the namespace and stores the schema. Runtime/client dispatch looks up the
 * schema before parsing extension messages.
 */
export class ExtensionRegistry {
  private readonly schemas = new Map<string, z.ZodTypeAny>();

  /** Whether this registry currently knows about `name`. */
  public has(name: string): boolean {
    return this.schemas.has(name);
  }

  /** Names of all registered extensions. */
  public list(): readonly string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Register an extension type with its payload schema.
   * @throws {InvalidArgumentError} if `name` is not a valid namespace.
   */
  public register<S extends z.ZodTypeAny>(name: string, schema: S): void {
    if (!isExtensionName(name)) {
      throw new InvalidArgumentError(
        `Cannot register "${name}": not a valid extension namespace (§21.1)`,
        { details: { name } },
      );
    }
    this.schemas.set(name, schema);
  }

  /**
   * Parse an extension payload. Throws if the extension is unknown.
   */
  public parse<T = unknown>(name: string, payload: unknown): T {
    const schema = this.schemas.get(name);
    if (schema === undefined) {
      throw new NotImplementedError(`Extension "${name}" is not registered`, {
        details: { name },
      });
    }
    return schema.parse(payload) as T;
  }

  /** Remove a registered extension; primarily used in tests. */
  public unregister(name: string): boolean {
    return this.schemas.delete(name);
  }
}
