import { z } from "zod";

// ARCP v1.0 §8.2 — `artifact_ref` event kind body shape only. There is no
// top-level artifact envelope in v1.0; agents emit a `job.event` with
// `kind = "artifact_ref"` and the body shape below.

/** §8.2 `artifact_ref` event-kind body. */
export const ArtifactRefSchema = z.object({
  uri: z.string().min(1),
  content_type: z.string().min(1),
  byte_size: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

/** No top-level artifact envelopes in v1.0. */
export const ARTIFACT_ENVELOPES = [] as const;
