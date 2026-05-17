import {
  TaggedAgentNotAvailable,
  TaggedAgentVersionNotAvailable,
} from "@arcp/core";
import {
  AgentNotAvailableError,
  AgentVersionNotAvailableError,
} from "@arcp/core/errors";
import type { AgentInventoryEntry } from "@arcp/core/messages";
import { getOrCreate } from "@arcp/core/util";
import { Effect, Ref } from "effect";

import type { AgentHandler } from "./types.js";

/**
 * Stores registered agent handlers (optionally versioned per v1.1 §7.5) and
 * resolves submissions to a concrete handler. The empty-string version slot
 * holds the un-versioned handler registered via {@link register}.
 */
export class AgentRegistry {
  private readonly handlers = new Map<string, Map<string, AgentHandler>>();
  private readonly defaults = new Map<string, string>();

  public register<Input = unknown, Result = unknown>(
    name: string,
    handler: AgentHandler<Input, Result>,
  ): void {
    this.bucket(name).set("", handler as AgentHandler);
  }

  public registerVersion<Input = unknown, Result = unknown>(
    name: string,
    version: string,
    handler: AgentHandler<Input, Result>,
  ): void {
    this.bucket(name).set(version, handler as AgentHandler);
  }

  public setDefaultVersion(name: string, version: string): void {
    this.defaults.set(name, version);
  }

  public has(name: string): boolean {
    return this.handlers.has(name);
  }

  public resolve(
    name: string,
    version: string | null,
  ): { handler: AgentHandler; version: string } {
    const bucket = this.handlers.get(name);
    if (bucket === undefined || bucket.size === 0) {
      throw new AgentNotAvailableError(`Agent "${name}" is not registered`);
    }
    if (version !== null) {
      return resolveExplicitVersion(name, version, bucket);
    }
    return this.resolveDefault(name, bucket);
  }

  public inventory(): AgentInventoryEntry[] {
    const out: AgentInventoryEntry[] = [];
    for (const [name, bucket] of this.handlers.entries()) {
      const versions = [...bucket.keys()].filter((v) => v !== "");
      const entry: AgentInventoryEntry = { name, versions };
      const def = this.defaults.get(name);
      if (def !== undefined && versions.includes(def)) entry.default = def;
      out.push(entry);
    }
    return out;
  }

  private resolveDefault(
    name: string,
    bucket: Map<string, AgentHandler>,
  ): { handler: AgentHandler; version: string } {
    const defaultVersion = this.defaults.get(name);
    if (defaultVersion !== undefined) {
      const handler = bucket.get(defaultVersion);
      if (handler === undefined) {
        throw new AgentVersionNotAvailableError(
          `Default agent version "${name}@${defaultVersion}" is not registered`,
        );
      }
      return { handler, version: defaultVersion };
    }
    const unversioned = bucket.get("");
    if (unversioned !== undefined) {
      return { handler: unversioned, version: "" };
    }
    const firstEntry = bucket.entries().next().value;
    if (firstEntry === undefined) {
      throw new AgentNotAvailableError(`Agent "${name}" is not registered`);
    }
    const [v, h] = firstEntry;
    return { handler: h, version: v };
  }

  private bucket(name: string): Map<string, AgentHandler> {
    return getOrCreate(
      this.handlers,
      name,
      () => new Map<string, AgentHandler>(),
    );
  }
}

function resolveExplicitVersion(
  name: string,
  version: string,
  bucket: Map<string, AgentHandler>,
): { handler: AgentHandler; version: string } {
  const handler = bucket.get(version);
  if (handler === undefined) {
    throw new AgentVersionNotAvailableError(
      `Agent "${name}@${version}" is not registered`,
    );
  }
  return { handler, version };
}

// ============================================================================
// Effect-shaped twin — `AgentRegistryService`
// ============================================================================

/**
 * Failure modes surfaced on the typed-error channel for
 * {@link AgentRegistryService}. Mirrors the legacy class:
 *   - unknown agent name → {@link TaggedAgentNotAvailable}
 *   - unknown version    → {@link TaggedAgentVersionNotAvailable}
 */
export type AgentRegistryFailure =
  | TaggedAgentNotAvailable
  | TaggedAgentVersionNotAvailable;

/** Resolved handler plus the version slot it came from. */
export interface ResolvedAgent {
  readonly handler: AgentHandler;
  readonly version: string;
}

type RegistryState = ReadonlyMap<string, ReadonlyMap<string, AgentHandler>>;

const EMPTY_STATE: RegistryState = new Map();

interface HandlerInsert {
  readonly name: string;
  readonly version: string;
  readonly handler: AgentHandler;
}

function withHandler(
  state: RegistryState,
  insert: HandlerInsert,
): RegistryState {
  const next = new Map(state);
  const existing = state.get(insert.name);
  const bucket =
    existing === undefined
      ? new Map<string, AgentHandler>()
      : new Map(existing);
  bucket.set(insert.version, insert.handler);
  next.set(insert.name, bucket);
  return next;
}

function pickFromBucket(
  bucket: ReadonlyMap<string, AgentHandler>,
  version: string | null,
): ResolvedAgent | { readonly missingVersion: string } {
  if (version !== null) {
    const handler = bucket.get(version);
    return handler === undefined
      ? { missingVersion: version }
      : { handler, version };
  }
  const unversioned = bucket.get("");
  if (unversioned !== undefined) return { handler: unversioned, version: "" };
  const first = bucket.entries().next().value;
  if (first === undefined) return { missingVersion: "" };
  const [v, h] = first;
  return { handler: h, version: v };
}

function resolveFromState(
  state: RegistryState,
  name: string,
  version: string | null,
): Effect.Effect<ResolvedAgent, AgentRegistryFailure> {
  const bucket = state.get(name);
  if (bucket === undefined || bucket.size === 0) {
    return Effect.fail(
      new TaggedAgentNotAvailable({
        message: `Agent "${name}" is not registered`,
      }),
    );
  }
  const picked = pickFromBucket(bucket, version);
  if ("missingVersion" in picked) {
    return Effect.fail(
      new TaggedAgentVersionNotAvailable({
        message: `Agent "${name}@${picked.missingVersion}" is not registered`,
      }),
    );
  }
  return Effect.succeed(picked);
}

function makeOps(ref: Ref.Ref<RegistryState>) {
  return {
    register: (
      name: string,
      version: string,
      handler: AgentHandler,
    ): Effect.Effect<void> =>
      Ref.update(ref, (s) => withHandler(s, { name, version, handler })),
    resolve: (
      name: string,
      version: string | null,
    ): Effect.Effect<ResolvedAgent, AgentRegistryFailure> =>
      Ref.get(ref).pipe(
        Effect.flatMap((s) => resolveFromState(s, name, version)),
      ),
    has: (name: string): Effect.Effect<boolean> =>
      Ref.get(ref).pipe(Effect.map((s) => s.has(name))),
    unregister: (name: string): Effect.Effect<boolean> =>
      Ref.modify(ref, (s) => {
        if (!s.has(name)) return [false, s];
        const next = new Map(s);
        next.delete(name);
        return [true, next];
      }),
    list: (): Effect.Effect<readonly AgentInventoryEntry[]> =>
      Ref.get(ref).pipe(Effect.map((s) => snapshotInventory(s))),
  } as const;
}

function snapshotInventory(state: RegistryState): AgentInventoryEntry[] {
  const out: AgentInventoryEntry[] = [];
  for (const [name, bucket] of state.entries()) {
    const versions = [...bucket.keys()].filter((v) => v !== "");
    out.push({ name, versions });
  }
  return out;
}

/**
 * Effect-shaped twin of {@link AgentRegistry}. Backs the handler map with a
 * {@link Ref} so concurrent fibers can `register`, `resolve`, and `unregister`
 * without trampling each other. `resolve(name, null)` preserves the legacy
 * "first registered version" semantics: it prefers the empty-string slot if
 * present, otherwise picks the first entry in insertion order. Runtime
 * defaults (`setDefaultVersion`) are a legacy-only concern and intentionally
 * not modelled here.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const reg = yield* AgentRegistryService
 *   yield* reg.register("planner", "v1", handler)
 *   const { handler: h } = yield* reg.resolve("planner", "v1")
 *   return h
 * }).pipe(Effect.provide(AgentRegistryService.Default))
 * ```
 */
export class AgentRegistryService extends Effect.Service<AgentRegistryService>()(
  "arcp/AgentRegistryService",
  {
    effect: Effect.gen(function* () {
      const ref = yield* Ref.make<RegistryState>(EMPTY_STATE);
      return makeOps(ref);
    }),
  },
) {}
