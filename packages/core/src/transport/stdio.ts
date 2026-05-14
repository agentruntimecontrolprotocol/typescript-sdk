import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { InvalidRequestError } from "../errors.js";

import type {
  FrameHandler,
  SendableFrame,
  Transport,
  WireFrame,
} from "./types.js";

/**
 * Newline-delimited JSON transport over a pair of streams (§22).
 *
 * Each frame is JSON-encoded then terminated by `\n`. Backpressure on the
 * write side is honored implicitly by `stream.write`'s drain semantics.
 *
 * For server use:  `StdioTransport.fromProcess()` (uses process.stdin/stdout).
 * For client use:  `StdioTransport.fromChild(child)` (uses child.stdout/stdin).
 */
export class StdioTransport implements Transport {
  private handler: FrameHandler | null = null;
  private closeHandler: ((err?: Error) => void) | null = null;
  private rl: Interface | null = null;
  private isClosed = false;
  private inboundChain: Promise<void> = Promise.resolve();

  public constructor(
    private readonly readable: Readable,
    private readonly writable: Writable,
  ) {}

  public get closed(): boolean {
    return this.isClosed;
  }

  /** Construct a transport bound to the current process's stdio. */
  public static fromProcess(): StdioTransport {
    return new StdioTransport(process.stdin, process.stdout);
  }

  /**
   * Construct a transport that talks to a spawned child process. The parent
   * writes to the child's stdin and reads from the child's stdout.
   */
  public static fromChild(child: {
    stdin: Writable | null;
    stdout: Readable | null;
  }): StdioTransport {
    if (child.stdin === null || child.stdout === null) {
      throw new InvalidRequestError(
        "Child process must be spawned with stdin and stdout pipes",
      );
    }
    return new StdioTransport(child.stdout, child.stdin);
  }

  public async send(frame: SendableFrame): Promise<void> {
    if (this.isClosed)
      throw new InvalidRequestError("StdioTransport is closed");
    const line = `${JSON.stringify(frame)}\n`;
    return new Promise<void>((resolve, reject) => {
      this.writable.write(line, "utf8", (err) => {
        if (err !== null && err !== undefined) reject(err);
        else resolve();
      });
    });
  }

  public onFrame(handler: FrameHandler): void {
    if (this.handler !== null) {
      throw new InvalidRequestError(
        "StdioTransport already has a frame handler",
      );
    }
    this.handler = handler;
    this.rl = createInterface({
      input: this.readable,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.rl.on("line", (line) => {
      if (line.trim() === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Bad JSON — drop. Do not crash.
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        return;
      const frame = parsed as WireFrame;
      this.inboundChain = this.inboundChain
        .then(() => handler(frame))
        .catch((): void => {
          /* Keep the queue alive on handler failure. */
        });
    });
    this.rl.on("close", () => {
      this.fireClose();
    });
    this.readable.on("error", (err) => {
      this.fireClose(err);
    });
  }

  public onClose(handler: (err?: Error) => void): void {
    this.closeHandler = handler;
  }

  // Transport.close is async-by-contract; the stdio impl finishes synchronously.
  // eslint-disable-next-line @typescript-eslint/require-await
  public async close(_reason?: string): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    this.rl?.close();
    this.fireClose();
  }

  private fireClose(err?: Error): void {
    if (this.closeHandler !== null) {
      const handler = this.closeHandler;
      this.closeHandler = null;
      handler(err);
    }
  }
}
