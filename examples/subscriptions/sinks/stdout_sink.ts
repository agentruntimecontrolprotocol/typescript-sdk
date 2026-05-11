/** Stdout sink — production version uses pino or similar. */
import type { BaseEnvelope } from "../../../src/index.js";

export class StdoutSink {
  public async handle(_env: BaseEnvelope): Promise<void> {
    // Real version: logger.info(env.type, env.payload)
    throw new Error("not implemented");
  }
}
