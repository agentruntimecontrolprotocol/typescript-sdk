import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../src/errors.js";
import { ArtifactStore } from "../../src/runtime/artifact.js";

describe("ArtifactStore", () => {
  it("rejects fetch from a different session than put", () => {
    const store = new ArtifactStore();
    const ref = store.put("sess-a", {
      media_type: "text/plain",
      data: Buffer.from("secret").toString("base64"),
      encoding: "base64",
    });
    expect(() => store.fetch("sess-b", ref.artifact_id)).toThrow(NotFoundError);
  });
});
