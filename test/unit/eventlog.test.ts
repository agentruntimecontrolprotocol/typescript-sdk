import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BaseEnvelope } from "../../src/index.js";
import {
  buildEnvelope,
  EventLog,
  InvalidArgumentError,
  newMessageId,
  newSessionId,
  nowTimestamp,
  PROTOCOL_VERSION,
} from "../../src/index.js";

function makeEnv(overrides: Partial<BaseEnvelope> = {}): BaseEnvelope {
  return {
    arcp: PROTOCOL_VERSION,
    id: overrides.id ?? newMessageId(),
    type: overrides.type ?? "ping",
    timestamp: overrides.timestamp ?? nowTimestamp(),
    payload: overrides.payload ?? {},
    ...(overrides.session_id !== undefined ? { session_id: overrides.session_id } : {}),
    ...(overrides.job_id !== undefined ? { job_id: overrides.job_id } : {}),
    ...(overrides.stream_id !== undefined ? { stream_id: overrides.stream_id } : {}),
    ...(overrides.subscription_id !== undefined
      ? { subscription_id: overrides.subscription_id }
      : {}),
    ...(overrides.trace_id !== undefined ? { trace_id: overrides.trace_id } : {}),
    ...(overrides.span_id !== undefined ? { span_id: overrides.span_id } : {}),
    ...(overrides.correlation_id !== undefined ? { correlation_id: overrides.correlation_id } : {}),
    ...(overrides.causation_id !== undefined ? { causation_id: overrides.causation_id } : {}),
    ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
  };
}

describe("EventLog", () => {
  let log: EventLog;
  const sess = newSessionId();

  beforeEach(() => {
    log = new EventLog();
  });

  afterEach(async () => {
    await log.close();
  });

  it("appends an envelope and returns true for new inserts", async () => {
    const env = makeEnv({ session_id: sess });
    const inserted = await log.append(env);
    expect(inserted).toBe(true);
    expect(await log.count(sess)).toBe(1);
  });

  it("is idempotent on (session_id, id) — same envelope inserted twice", async () => {
    const env = makeEnv({ session_id: sess, id: "msg_dup" });
    expect(await log.append(env)).toBe(true);
    expect(await log.append(env)).toBe(false);
    expect(await log.count(sess)).toBe(1);
  });

  it("accepts the same id under a different session_id", async () => {
    const sess2 = newSessionId();
    const env1 = makeEnv({ session_id: sess, id: "msg_same" });
    const env2 = makeEnv({ session_id: sess2, id: "msg_same" });
    await log.append(env1);
    await log.append(env2);
    expect(await log.count(sess)).toBe(1);
    expect(await log.count(sess2)).toBe(1);
  });

  it("requires session_id on append", async () => {
    const env = makeEnv();
    await expect(log.append(env)).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it("readSince returns events strictly after the given id, ordered ascending", async () => {
    const ids = ["msg_001", "msg_002", "msg_003", "msg_004"];
    for (const id of ids) {
      await log.append(makeEnv({ session_id: sess, id }));
    }
    const got = await log.readSince(sess, "msg_002");
    expect(got.map((e) => e.id)).toEqual(["msg_003", "msg_004"]);
  });

  it("readSince with no after_id returns everything for the session", async () => {
    for (let i = 0; i < 5; i++) {
      await log.append(makeEnv({ session_id: sess, id: `msg_${i}` }));
    }
    const all = await log.readSince(sess);
    expect(all.length).toBe(5);
  });

  it("readSince respects the limit", async () => {
    for (let i = 0; i < 10; i++) {
      await log.append(makeEnv({ session_id: sess, id: `msg_${i}` }));
    }
    const got = await log.readSince(sess, "", 3);
    expect(got.length).toBe(3);
  });

  it("preserves all envelope fields through round-trip", async () => {
    const env = buildEnvelope({
      id: "msg_full",
      type: "metric",
      timestamp: nowTimestamp(),
      payload: { name: "tokens.used", value: 42, unit: "tokens" },
      optional: {
        session_id: sess,
        trace_id: "trace_abc",
        span_id: "span_def",
        correlation_id: "msg_origin",
        priority: "high",
        extensions: { "arcpx.acme.tag.v1": { tier: "gold" } },
      },
    });
    await log.append(env as BaseEnvelope);
    const back = await log.getById(sess, "msg_full");
    expect(back).not.toBeNull();
    expect(back?.trace_id).toBe("trace_abc");
    expect(back?.priority).toBe("high");
    expect(back?.payload).toEqual({ name: "tokens.used", value: 42, unit: "tokens" });
  });

  it("appendBatch inserts many in a single transaction", async () => {
    const envs = Array.from({ length: 20 }, (_, i) =>
      makeEnv({ session_id: sess, id: `msg_b_${i}` }),
    );
    const inserted = await log.appendBatch(envs);
    expect(inserted).toBe(20);
    expect(await log.count(sess)).toBe(20);
  });

  it("appendBatch is partial-idempotent: existing rows skipped", async () => {
    await log.append(makeEnv({ session_id: sess, id: "msg_x" }));
    const envs = [
      makeEnv({ session_id: sess, id: "msg_x" }),
      makeEnv({ session_id: sess, id: "msg_y" }),
    ];
    const inserted = await log.appendBatch(envs);
    expect(inserted).toBe(1);
    expect(await log.count(sess)).toBe(2);
  });

  it("query filters by session_id", async () => {
    const sess2 = newSessionId();
    await log.append(makeEnv({ session_id: sess, id: "msg_a" }));
    await log.append(makeEnv({ session_id: sess2, id: "msg_b" }));
    const result = await log.query({ session_id: sess });
    expect(result.map((e) => e.id)).toEqual(["msg_a"]);
  });

  it("query filters by job_id", async () => {
    await log.append(makeEnv({ session_id: sess, id: "msg_1", job_id: "job_a" }));
    await log.append(makeEnv({ session_id: sess, id: "msg_2", job_id: "job_b" }));
    const result = await log.query({ job_id: "job_a" });
    expect(result.map((e) => e.id)).toEqual(["msg_1"]);
  });

  it("query filters by trace_id", async () => {
    await log.append(makeEnv({ session_id: sess, id: "msg_1", trace_id: "t1" }));
    await log.append(makeEnv({ session_id: sess, id: "msg_2", trace_id: "t2" }));
    const result = await log.query({ trace_id: "t1" });
    expect(result).toHaveLength(1);
  });

  it("query filters by types (OR within array)", async () => {
    await log.append(makeEnv({ session_id: sess, id: "msg_1", type: "log" }));
    await log.append(makeEnv({ session_id: sess, id: "msg_2", type: "metric" }));
    await log.append(makeEnv({ session_id: sess, id: "msg_3", type: "ping" }));
    const result = await log.query({ types: ["log", "metric"] });
    expect(result.map((e) => e.id).sort()).toEqual(["msg_1", "msg_2"]);
  });

  it("query respects after_id ordering across the entire log", async () => {
    await log.append(makeEnv({ session_id: sess, id: "msg_001" }));
    await log.append(makeEnv({ session_id: sess, id: "msg_002" }));
    await log.append(makeEnv({ session_id: sess, id: "msg_003" }));
    const result = await log.query({ session_id: sess, after_id: "msg_001" });
    expect(result.map((e) => e.id)).toEqual(["msg_002", "msg_003"]);
  });

  it("close() makes subsequent calls reject", async () => {
    const local = new EventLog();
    await local.close();
    await expect(local.append(makeEnv({ session_id: sess }))).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
    await expect(local.readSince(sess)).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it("close() is idempotent", async () => {
    const local = new EventLog();
    await local.close();
    await expect(local.close()).resolves.not.toThrow();
  });

  it("getById returns null for missing rows", async () => {
    const got = await log.getById(sess, "msg_nope");
    expect(got).toBeNull();
  });

  it("count() with no sessionId counts every row across sessions", async () => {
    const sess2 = newSessionId();
    await log.append(makeEnv({ session_id: sess, id: "msg_a" }));
    await log.append(makeEnv({ session_id: sess2, id: "msg_b" }));
    expect(await log.count()).toBe(2);
  });

  it("close() also blocks count, getById, query, appendBatch", async () => {
    const local = new EventLog();
    await local.close();
    await expect(local.count()).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(local.getById(sess, "x")).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(local.query({})).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(local.appendBatch([])).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it("appendBatch rejects an envelope without session_id", async () => {
    const envs = [makeEnv({ session_id: sess, id: "ok" }), makeEnv({ id: "bad" })];
    await expect(log.appendBatch(envs)).rejects.toBeInstanceOf(InvalidArgumentError);
  });

  it("query supports every filter dimension simultaneously", async () => {
    await log.append(
      makeEnv({
        session_id: sess,
        id: "msg_q1",
        job_id: "job_a",
        stream_id: "str_a",
        subscription_id: "sub_a",
        trace_id: "trace_a",
        correlation_id: "corr_a",
        causation_id: "cause_a",
        type: "log",
        priority: "high",
      }),
    );
    await log.append(
      makeEnv({
        session_id: sess,
        id: "msg_q2",
        job_id: "job_b",
        type: "metric",
        priority: "low",
      }),
    );
    const result = await log.query({
      session_id: sess,
      job_id: "job_a",
      stream_id: "str_a",
      subscription_id: "sub_a",
      trace_id: "trace_a",
      correlation_id: "corr_a",
      causation_id: "cause_a",
      types: ["log"],
      priorities: ["high"],
      after_id: "",
      limit: 10,
    });
    expect(result.map((e) => e.id)).toEqual(["msg_q1"]);
  });

  it("readonly mode rejects writes", async () => {
    const ro = new EventLog({ readonly: true });
    await expect(ro.append(makeEnv({ session_id: sess }))).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
    await expect(ro.appendBatch([makeEnv({ session_id: sess })])).rejects.toBeInstanceOf(
      InvalidArgumentError,
    );
    await ro.close();
  });
});
