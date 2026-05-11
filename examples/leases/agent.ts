/**
 * Stand-in for the Anthropic tool-use loop. Real version: an
 * `@anthropic-ai/sdk` client with a system prompt, yielding one
 * LLMStep per turn.
 */

export interface ToolCall {
  argv: string[];
  reason: string;
}

export interface LLMStep {
  thought: string;
  toolCall?: ToolCall;
  final?: string;
}

export function llmLoop(_userRequest: string): AsyncIterable<LLMStep> {
  throw new Error("not implemented");
}
