import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ArtifactRefSchema } from "@arcp/core";

// `ArtifactRefSchema` is the migrated Effect-`Schema` definition of the
// §8.2 `artifact_ref` event-kind body. Tests pin the JSON shapes accepted
// and rejected by the legacy zod schema so a future regression that
// loosens or tightens the contract is caught at CI time.

const decode = (input: unknown) =>
  Effect.runPromise(Schema.decodeUnknown(ArtifactRefSchema)(input));

const encode = (
  input: Schema.Schema.Type<typeof ArtifactRefSchema>,
): Promise<Schema.Schema.Encoded<typeof ArtifactRefSchema>> =>
  Effect.runPromise(Schema.encode(ArtifactRefSchema)(input));

describe("ArtifactRefSchema (Effect Schema)", () => {
  describe("decode — accepts", () => {
    it("accepts the minimum required shape (uri + content_type)", async () => {
      const input = {
        uri: "s3://bucket/key",
        content_type: "application/json",
      };
      await expect(decode(input)).resolves.toEqual(input);
    });

    it("accepts the docs/guides/job-events.md example shape", async () => {
      // From docs/guides/job-events.md §8.2:
      //   `artifact_ref` body: `{ uri, content_type, byte_size?, sha256? }`
      const input = {
        uri: "https://files.example.com/run-42.log",
        content_type: "text/plain",
        byte_size: 1024,
        sha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      };
      await expect(decode(input)).resolves.toEqual(input);
    });

    it("accepts byte_size = 0 (nonnegative integer floor)", async () => {
      const input = {
        uri: "data:,",
        content_type: "text/plain",
        byte_size: 0,
      };
      await expect(decode(input)).resolves.toEqual(input);
    });
  });

  describe("decode — rejects", () => {
    it("rejects empty uri (zod parity: .min(1))", async () => {
      await expect(
        decode({ uri: "", content_type: "text/plain" }),
      ).rejects.toThrow();
    });

    it("rejects empty content_type (zod parity: .min(1))", async () => {
      await expect(
        decode({ uri: "s3://b/k", content_type: "" }),
      ).rejects.toThrow();
    });

    it("rejects negative byte_size", async () => {
      await expect(
        decode({
          uri: "s3://b/k",
          content_type: "text/plain",
          byte_size: -1,
        }),
      ).rejects.toThrow();
    });

    it("rejects non-integer byte_size", async () => {
      await expect(
        decode({
          uri: "s3://b/k",
          content_type: "text/plain",
          byte_size: 1.5,
        }),
      ).rejects.toThrow();
    });

    it("rejects missing required fields", async () => {
      await expect(decode({ uri: "s3://b/k" })).rejects.toThrow();
    });
  });

  describe("encode — round-trip", () => {
    it("preserves the input shape through decode → encode", async () => {
      const input = {
        uri: "ipfs://Qm…",
        content_type: "image/png",
        byte_size: 42,
        sha256: "abc",
      };
      const decoded = await decode(input);
      const encoded = await encode(decoded);
      expect(encoded).toEqual(input);
    });
  });
});
