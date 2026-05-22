import {
  TaggedAgentNotAvailable,
  TaggedAgentVersionNotAvailable,
} from "@agentruntimecontrolprotocol/core";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { AgentRegistry, AgentRegistryService } from "../src/agent-registry.js";
import type { AgentHandler, JobContext } from "../src/types.js";

const stubCtx = {} as JobContext;

const makeHandler =
  (label: string): AgentHandler =>
  async () =>
    label;

function runWithService<A, E>(
  body: (
    reg: Effect.Effect.Success<typeof AgentRegistryService>,
  ) => Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const reg = yield* AgentRegistryService;
      return yield* body(reg);
    }).pipe(Effect.provide(AgentRegistryService.Default)),
  );
}

function runExitWithService<A, E>(
  body: (
    reg: Effect.Effect.Success<typeof AgentRegistryService>,
  ) => Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(
    Effect.gen(function* () {
      const reg = yield* AgentRegistryService;
      return yield* body(reg);
    }).pipe(Effect.provide(AgentRegistryService.Default)),
  );
}

describe("AgentRegistryService (Effect)", () => {
  it("registers one handler and resolves by name+version", async () => {
    const handler = makeHandler("v1");
    const result = await runWithService((reg) =>
      Effect.gen(function* () {
        yield* reg.register("planner", "v1", handler);
        const resolved = yield* reg.resolve("planner", "v1");
        return yield* Effect.promise(() =>
          Promise.resolve(resolved.handler("input", stubCtx)),
        );
      }),
    );
    expect(result).toBe("v1");
  });

  it("resolves null version to the first registered version", async () => {
    const result = await runWithService((reg) =>
      Effect.gen(function* () {
        yield* reg.register("planner", "v1", makeHandler("first"));
        yield* reg.register("planner", "v2", makeHandler("second"));
        const resolved = yield* reg.resolve("planner", null);
        return resolved.version;
      }),
    );
    expect(result).toBe("v1");
  });

  it("prefers the empty-version slot for null lookups", async () => {
    const result = await runWithService((reg) =>
      Effect.gen(function* () {
        yield* reg.register("planner", "v1", makeHandler("versioned"));
        yield* reg.register("planner", "", makeHandler("bare"));
        const resolved = yield* reg.resolve("planner", null);
        return resolved.version;
      }),
    );
    expect(result).toBe("");
  });

  it("fails with TaggedAgentNotAvailable for an unknown name", async () => {
    const exit = await runExitWithService((reg) => reg.resolve("ghost", "v1"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag !== "Some") return;
    expect(failure.value).toBeInstanceOf(TaggedAgentNotAvailable);
    expect(failure.value.message).toContain("ghost");
  });

  it("fails with TaggedAgentVersionNotAvailable for a known name + missing version", async () => {
    const exit = await runExitWithService((reg) =>
      Effect.gen(function* () {
        yield* reg.register("planner", "v1", makeHandler("v1"));
        return yield* reg.resolve("planner", "v9");
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag !== "Some") return;
    expect(failure.value).toBeInstanceOf(TaggedAgentVersionNotAvailable);
    expect(failure.value.message).toContain("planner@v9");
  });

  it("registers two handlers concurrently for distinct keys and both are visible", async () => {
    const inventory = await runWithService((reg) =>
      Effect.gen(function* () {
        yield* Effect.all(
          [
            reg.register("planner", "v1", makeHandler("planner")),
            reg.register("summarizer", "v2", makeHandler("summarizer")),
          ],
          { concurrency: 2 },
        );
        const a = yield* reg.resolve("planner", "v1");
        const b = yield* reg.resolve("summarizer", "v2");
        return {
          a: yield* Effect.promise(() =>
            Promise.resolve(a.handler("x", stubCtx)),
          ),
          b: yield* Effect.promise(() =>
            Promise.resolve(b.handler("y", stubCtx)),
          ),
          list: yield* reg.list(),
        };
      }),
    );
    expect(inventory.a).toBe("planner");
    expect(inventory.b).toBe("summarizer");
    const names = inventory.list.map((e) => e.name).sort();
    expect(names).toEqual(["planner", "summarizer"]);
  });

  it("unregister removes the bucket", async () => {
    const out = await runWithService((reg) =>
      Effect.gen(function* () {
        yield* reg.register("planner", "v1", makeHandler("v1"));
        const removed = yield* reg.unregister("planner");
        const stillThere = yield* reg.has("planner");
        return { removed, stillThere };
      }),
    );
    expect(out.removed).toBe(true);
    expect(out.stillThere).toBe(false);
  });
});

describe("AgentRegistry (legacy class) smoke test", () => {
  it("register + resolve round-trips for an unversioned agent", async () => {
    const reg = new AgentRegistry();
    const handler = makeHandler("bare");
    reg.register("planner", handler);
    const resolved = reg.resolve("planner", null);
    expect(resolved.version).toBe("");
    await expect(resolved.handler("input", stubCtx)).resolves.toBe("bare");
  });

  it("registerVersion + resolve by version returns that handler", async () => {
    const reg = new AgentRegistry();
    reg.registerVersion("planner", "v1", makeHandler("v1"));
    reg.registerVersion("planner", "v2", makeHandler("v2"));
    const resolved = reg.resolve("planner", "v2");
    expect(resolved.version).toBe("v2");
    await expect(resolved.handler("input", stubCtx)).resolves.toBe("v2");
  });

  it("default version selection is honored on null lookups", async () => {
    const reg = new AgentRegistry();
    reg.registerVersion("planner", "v1", makeHandler("v1"));
    reg.registerVersion("planner", "v2", makeHandler("v2"));
    reg.setDefaultVersion("planner", "v2");
    const resolved = reg.resolve("planner", null);
    expect(resolved.version).toBe("v2");
    await expect(resolved.handler("input", stubCtx)).resolves.toBe("v2");
  });

  it("inventory reports non-empty versions and the default", () => {
    const reg = new AgentRegistry();
    reg.registerVersion("planner", "v1", makeHandler("v1"));
    reg.registerVersion("planner", "v2", makeHandler("v2"));
    reg.setDefaultVersion("planner", "v2");
    const inv = reg.inventory();
    expect(inv).toEqual([
      { name: "planner", versions: ["v1", "v2"], default: "v2" },
    ]);
  });

  it("missing name throws AgentNotAvailableError", () => {
    const reg = new AgentRegistry();
    expect(() => reg.resolve("ghost", null)).toThrow(/not registered/);
  });

  it("missing version throws AgentVersionNotAvailableError", () => {
    const reg = new AgentRegistry();
    reg.registerVersion("planner", "v1", makeHandler("v1"));
    expect(() => reg.resolve("planner", "v9")).toThrow(/v9/);
  });
});
