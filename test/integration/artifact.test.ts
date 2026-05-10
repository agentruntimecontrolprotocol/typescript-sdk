import { describe, expect, it } from "vitest";
import { ARCPError } from "../../src/index.js";
import { makePairedHarness } from "../helpers/fixtures.js";

describe("§16 artifacts", () => {
  it("put + fetch round-trip preserves bytes and sha256", async () => {
    const h = makePairedHarness();
    await h.connect();
    const data = Buffer.from("hello world");
    const dataB64 = data.toString("base64");

    const ref = await h.client.putArtifact({
      media_type: "text/plain",
      data: dataB64,
      encoding: "base64",
    });
    expect(ref.artifact_id).toMatch(/^art_/);
    expect(ref.size).toBe(data.byteLength);
    expect(ref.sha256).toBeDefined();
    expect(ref.media_type).toBe("text/plain");

    const got = await h.client.fetchArtifact(ref.artifact_id);
    expect(got.data).toBe(dataB64);
    expect(got.media_type).toBe("text/plain");

    await h.close();
  });

  it("fetch after release returns NOT_FOUND", async () => {
    const h = makePairedHarness();
    await h.connect();
    const ref = await h.client.putArtifact({
      media_type: "application/octet-stream",
      data: Buffer.from("x").toString("base64"),
      encoding: "base64",
    });
    await h.client.releaseArtifact(ref.artifact_id);
    await expect(h.client.fetchArtifact(ref.artifact_id)).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });

  it("retention sweep removes expired artifacts", async () => {
    const h = makePairedHarness();
    await h.connect();
    const ref = await h.client.putArtifact({
      media_type: "text/plain",
      data: Buffer.from("expire").toString("base64"),
      encoding: "base64",
      ttl_seconds: 1,
    });
    // Force the stored artifact to expire by reaching into the store directly.
    await new Promise<void>((r) => setTimeout(r, 1100));
    h.server.artifacts.sweepNow();
    await expect(h.client.fetchArtifact(ref.artifact_id)).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });

  it("rejects non-base64 encoding", async () => {
    const h = makePairedHarness();
    await h.connect();
    await expect(
      h.client.putArtifact({
        media_type: "application/octet-stream",
        data: "raw-bytes-not-base64",
        // @ts-expect-error: deliberately invalid encoding
        encoding: "raw",
      }),
    ).rejects.toBeInstanceOf(ARCPError);
    await h.close();
  });
});
