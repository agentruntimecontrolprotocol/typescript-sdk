/**
 * Cheap-tier inference. Real version: anthropic SDK call with a system
 * prompt asking for a `Confidence: X.XX` line, then heuristics on top to
 * derive the final score.
 */

export async function attempt(_prompt: string): Promise<[string, number]> {
  throw new Error("not implemented");
}
