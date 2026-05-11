/** Primary + critic LLM stand-ins. */

export async function primaryStep(
  _request: string,
  _priorCritique: Record<string, unknown> | null,
): Promise<string> {
  // One reasoning step. Real version: an Anthropic call that folds
  // the critique into the prompt when present.
  throw new Error("not implemented");
}

export async function critiqueThought(
  _thought: string,
): Promise<["nudge" | "warn" | "halt", string, string | null, number]> {
  // Critic LLM. Returns [severity, summary, suggestion, tokens_consumed].
  throw new Error("not implemented");
}
