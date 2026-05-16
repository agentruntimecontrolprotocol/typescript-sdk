import {
  AgentNotAvailableError,
  AgentVersionNotAvailableError,
} from "@arcp/core/errors";
import type { AgentInventoryEntry } from "@arcp/core/messages";

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
      const handler = bucket.get(version);
      if (handler === undefined) {
        throw new AgentVersionNotAvailableError(
          `Agent "${name}@${version}" is not registered`,
        );
      }
      return { handler, version };
    }
    // bare name → prefer the runtime-configured default, else the unversioned
    // slot, else pick the first registered version.
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
    // Pick an arbitrary version. Clients that require stability MUST pin one.
    const firstEntry = bucket.entries().next().value;
    if (firstEntry === undefined) {
      throw new AgentNotAvailableError(`Agent "${name}" is not registered`);
    }
    const [v, h] = firstEntry;
    return { handler: h, version: v };
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

  private bucket(name: string): Map<string, AgentHandler> {
    let bucket = this.handlers.get(name);
    if (bucket === undefined) {
      bucket = new Map<string, AgentHandler>();
      this.handlers.set(name, bucket);
    }
    return bucket;
  }
}
