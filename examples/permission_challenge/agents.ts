/** Generator + reviewer stand-ins. Real version: AutoGen-equivalent agents. */
import type { BaseEnvelope } from "../../src/index.js";

export interface Patch {
  diff: string;
}

export interface ReviewVerdict {
  grant: boolean;
  reason: string;
}

export async function propose(_args: { ticket: string; priorDenial?: string }): Promise<Patch> {
  throw new Error("not implemented");
}

export async function review(_args: {
  ticket: string;
  request: BaseEnvelope;
}): Promise<ReviewVerdict> {
  // Reviewer parses the patch out of `request.payload.resource` or by
  // looking it up by fingerprint, then runs the LLM.
  throw new Error("not implemented");
}
