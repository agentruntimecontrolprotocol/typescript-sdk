import { describe, expect, it } from "vitest";

import type { Capabilities } from "@agentruntimecontrolprotocol/core";
import { negotiateCapabilities } from "@agentruntimecontrolprotocol/core/state";

// v1.1 §6.2 — the welcome's `capabilities.features` MUST be the intersection
// of the client's advertised feature set and the runtime's advertised set.
describe("negotiateCapabilities — feature intersection (issue #74)", () => {
  const empty: Capabilities = {};

  it("intersects when both client and runtime advertise features", () => {
    const out = negotiateCapabilities(
      { features: ["progress", "list_jobs", "ack"] },
      { features: ["progress", "ack", "result_chunk"] },
    );
    expect(out.features).toEqual(["progress", "ack"]);
  });

  it("returns runtime list when only runtime advertised", () => {
    const out = negotiateCapabilities(empty, { features: ["progress", "ack"] });
    expect(out.features).toEqual(["progress", "ack"]);
  });

  it("returns client list when only client advertised", () => {
    const out = negotiateCapabilities({ features: ["progress"] }, empty);
    expect(out.features).toEqual(["progress"]);
  });

  it("yields an empty array when client and runtime do not overlap", () => {
    const out = negotiateCapabilities(
      { features: ["progress"] },
      { features: ["list_jobs"] },
    );
    expect(out.features).toEqual([]);
  });

  it("leaves features undefined when neither side advertised", () => {
    const out = negotiateCapabilities(empty, empty);
    expect(out.features).toBeUndefined();
  });
});
