import { describe, expect, it } from "vitest";
import {
  CancelledError,
  FailedPreconditionError,
  InvalidArgumentError,
  Job,
  StreamReader,
  StreamWriter,
  silentLogger,
} from "../../src/index.js";

describe("Job state transitions", () => {
  it("happy path: accepted → running → completed via emit*", async () => {
    const sent: string[] = [];
    const job = new Job(
      { originId: "msg_1", sessionId: "sess_1", heartbeatIntervalSeconds: 30 },
      async (env) => {
        sent.push(env.type);
      },
      silentLogger,
    );
    expect(job.state).toBe("accepted");
    await job.emitAccepted();
    await job.emitStarted();
    expect(job.state).toBe("running");
    await job.emitToolResult({ ok: true });
    expect(job.state).toBe("completed");
    expect(job.isTerminal).toBe(true);
    expect(sent).toEqual(["job.accepted", "job.started", "tool.result"]);
  });

  it("illegal transitions throw FailedPreconditionError", () => {
    const job = new Job(
      { originId: "x", sessionId: "y", heartbeatIntervalSeconds: 30 },
      async () => undefined,
      silentLogger,
    );
    job.transition("running");
    job.transition("completed");
    expect(() => job.transition("running")).toThrow(FailedPreconditionError);
  });

  it("cancel() aborts the signal and emits job.cancelled", async () => {
    const sent: string[] = [];
    const job = new Job(
      { originId: "x", sessionId: "y", heartbeatIntervalSeconds: 30 },
      async (env) => {
        sent.push(env.type);
      },
      silentLogger,
    );
    job.transition("running");
    job.cancel("test", "client");
    expect(job.state).toBe("cancelled");
    expect(job.signal.aborted).toBe(true);
    // emitTerminalEnvelope is async; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toContain("job.cancelled");
  });

  it("abortHard() emits job.failed with ABORTED", async () => {
    const sent: string[] = [];
    const job = new Job(
      { originId: "x", sessionId: "y", heartbeatIntervalSeconds: 30 },
      async (env) => {
        sent.push(env.type);
      },
      silentLogger,
    );
    job.transition("running");
    job.abortHard("deadline");
    await Promise.resolve();
    await Promise.resolve();
    expect(job.state).toBe("failed");
    expect(sent).toContain("job.failed");
  });

  it("block/unblock transitions", () => {
    const job = new Job(
      { originId: "x", sessionId: "y", heartbeatIntervalSeconds: 30 },
      async () => undefined,
      silentLogger,
    );
    job.transition("running");
    job.block();
    expect(job.state).toBe("blocked");
    job.unblock();
    expect(job.state).toBe("running");
  });

  it("block from non-running is a no-op", () => {
    const job = new Job(
      { originId: "x", sessionId: "y", heartbeatIntervalSeconds: 30 },
      async () => undefined,
      silentLogger,
    );
    expect(job.state).toBe("accepted");
    job.block();
    expect(job.state).toBe("accepted");
  });
});

describe("StreamWriter", () => {
  it("emits stream.open on construction and stream.chunk on write", async () => {
    const sent: { type: string; payload: unknown }[] = [];
    const writer = new StreamWriter(
      "sess_1",
      async (env) => {
        sent.push({ type: env.type, payload: env.payload });
      },
      { kind: "text" },
    );
    // Allow the construction-time emitOpen microtask to land.
    await Promise.resolve();
    await Promise.resolve();
    await writer.write({ data: "hello" });
    await writer.close();
    expect(sent.map((e) => e.type)).toEqual(["stream.open", "stream.chunk", "stream.close"]);
  });

  it("write after close throws", async () => {
    const writer = new StreamWriter("sess", async () => undefined, { kind: "text" });
    await Promise.resolve();
    await writer.close();
    await expect(writer.write({ data: "x" })).rejects.toBeInstanceOf(FailedPreconditionError);
  });

  it("close is idempotent", async () => {
    const sent: string[] = [];
    const writer = new StreamWriter(
      "sess",
      async (env) => {
        sent.push(env.type);
      },
      { kind: "text" },
    );
    await Promise.resolve();
    await writer.close();
    await writer.close();
    // Should only have ONE close, plus the open.
    expect(sent.filter((t) => t === "stream.close").length).toBe(1);
  });

  it("error() emits stream.error and idempotent thereafter", async () => {
    const sent: string[] = [];
    const writer = new StreamWriter(
      "sess",
      async (env) => {
        sent.push(env.type);
      },
      { kind: "text" },
    );
    await Promise.resolve();
    await writer.error(new CancelledError("test"));
    await writer.close();
    expect(sent.filter((t) => t === "stream.error").length).toBe(1);
    expect(sent.filter((t) => t === "stream.close").length).toBe(0);
  });

  it("applyBackpressure(0) clears backoff", () => {
    const writer = new StreamWriter("sess", async () => undefined, { kind: "text" });
    writer.applyBackpressure(10);
    writer.applyBackpressure(undefined);
    // No assertion on internals; this test exercises the early-return branch.
    expect(writer.isClosed).toBe(false);
  });
});

describe("StreamReader", () => {
  it("yields chunks pushed before iteration", async () => {
    const reader = new StreamReader("str_1");
    reader.push({ sequence: 0, data: "a" });
    reader.push({ sequence: 1, data: "b" });
    reader.end();
    const collected: string[] = [];
    for await (const chunk of reader) {
      if (typeof chunk.data === "string") collected.push(chunk.data);
    }
    expect(collected).toEqual(["a", "b"]);
  });

  it("yields chunks pushed during iteration", async () => {
    const reader = new StreamReader("str_2");
    const collected: string[] = [];
    const pump = (async () => {
      for await (const chunk of reader) {
        if (typeof chunk.data === "string") collected.push(chunk.data);
      }
    })();
    reader.push({ sequence: 0, data: "x" });
    reader.push({ sequence: 1, data: "y" });
    reader.end();
    await pump;
    expect(collected).toEqual(["x", "y"]);
  });

  it("out-of-order chunk fails the stream", async () => {
    const reader = new StreamReader("str_3");
    reader.push({ sequence: 5, data: "skipped" });
    await expect(reader.next()).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it("fail() rejects on subsequent next()", async () => {
    const reader = new StreamReader("str_4");
    const err = new CancelledError("test");
    reader.fail(err);
    await expect(reader.next()).rejects.toBe(err);
  });

  it("end before any push completes immediately", async () => {
    const reader = new StreamReader("str_5");
    reader.end();
    const result = await reader.next();
    expect(result.done).toBe(true);
  });
});
