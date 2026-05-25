import { Deferred } from "@agentruntimecontrolprotocol/core/util";
import { describe, expect, it } from "vitest";

import { makeHandleFromInvocation } from "../src/client-handle.js";
import type { InvocationState } from "../src/client-handle.js";
import type {
  JobAcceptedPayload,
  JobResultPayload,
} from "@agentruntimecontrolprotocol/core/messages";

function makeInvocation(): InvocationState {
  const acceptance = new Deferred<JobAcceptedPayload>();
  const completion = new Deferred<JobResultPayload>();
  completion.promise.catch(() => undefined);
  acceptance.promise.catch(() => undefined);
  return {
    jobId: "job_1" as never,
    lease: {},
    agent: "echo",
    leaseConstraints: undefined,
    budget: undefined,
    credentials: undefined,
    traceId: undefined,
    events: [],
    acceptance,
    completion,
    chunks: new Map(),
  };
}

describe("makeHandleFromInvocation", () => {
  it("returns utf8 chunk data as a string", async () => {
    const inv = makeInvocation();
    const handle = makeHandleFromInvocation(inv);
    inv.chunks.set("res_1", [
      { result_id: "res_1", chunk_seq: 1, data: "world", encoding: "utf8", more: true },
      { result_id: "res_1", chunk_seq: 0, data: "hello ", encoding: "utf8", more: true },
    ]);
    inv.completion.resolve({
      final_status: "success",
      result_id: "res_1",
    });
    await expect(handle.collectChunks()).resolves.toBe("hello world");
  });

  it("returns mixed-encoding chunk data as a Buffer", async () => {
    const inv = makeInvocation();
    const handle = makeHandleFromInvocation(inv);
    inv.chunks.set("res_1", [
      { result_id: "res_1", chunk_seq: 0, data: "aGVsbG8=", encoding: "base64", more: true },
      { result_id: "res_1", chunk_seq: 1, data: "!", encoding: "utf8", more: false },
    ]);
    inv.completion.resolve({
      final_status: "success",
      result_id: "res_1",
    });
    const out = await handle.collectChunks();
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString("utf8")).toBe("hello!");
  });

  it("returns an empty string when no chunks were emitted", async () => {
    const inv = makeInvocation();
    const handle = makeHandleFromInvocation(inv);
    inv.completion.resolve({
      final_status: "success",
      result_id: "res_1",
    });
    await expect(handle.collectChunks()).resolves.toBe("");
  });

  it("throws when the result has no result_id", async () => {
    const inv = makeInvocation();
    const handle = makeHandleFromInvocation(inv);
    inv.completion.resolve({
      final_status: "success",
      result: null,
    });
    await expect(handle.collectChunks()).rejects.toThrow(/result_id/);
  });
});
