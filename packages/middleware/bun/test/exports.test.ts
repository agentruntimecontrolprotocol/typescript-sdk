import { describe, expect, it } from "vitest";

import * as bunMiddleware from "../src/index.js";

describe("@agentruntimecontrolprotocol/bun", () => {
  it("exports the expected surface", () => {
    expect(typeof bunMiddleware.serveArcp).toBe("function");
    expect(typeof bunMiddleware.BunWebSocketTransport).toBe("function");
  });

  it("serveArcp throws under non-Bun runtimes", () => {
    // This file is executed by Node + Vitest, so the `Bun` global is absent
    // and `serveArcp` must refuse to run. A real Bun smoke test should run
    // under `bun test` directly.
    expect(() =>
      bunMiddleware.serveArcp({
        onTransport: () => undefined,
      }),
    ).toThrow(/Bun runtime/);
  });
});
