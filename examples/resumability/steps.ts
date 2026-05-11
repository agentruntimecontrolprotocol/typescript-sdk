/**
 * Step bodies. Real version: a node per step (Anthropic call for
 * plan / synth / critique / finalize, retriever for gather).
 */
import type { ARCPClient } from "../../src/index.js";

export async function runStep(
  _client: ARCPClient,
  _args: { jobId: string; step: string; inputs: Record<string, unknown> },
): Promise<unknown> {
  throw new Error("not implemented");
}
