import { describe, expect, it } from "vitest";
import {
  IMPL_VERSION,
  isCompatibleVersion,
  newArtifactId,
  newId,
  newJobId,
  newLeaseId,
  newMessageId,
  newSessionId,
  newStreamId,
  newSubscriptionId,
  nowTimestamp,
  PROTOCOL_VERSION,
  rootLogger,
  sessionLogger,
  silentLogger,
} from "../../src/index.js";

describe("version", () => {
  it("PROTOCOL_VERSION is 1.0", () => {
    expect(PROTOCOL_VERSION).toBe("1.0");
  });

  it("IMPL_VERSION is 0.1.0", () => {
    expect(IMPL_VERSION).toBe("0.1.0");
  });

  it("isCompatibleVersion accepts same major", () => {
    expect(isCompatibleVersion("1.0")).toBe(true);
    expect(isCompatibleVersion("1.5")).toBe(true);
    expect(isCompatibleVersion("1.99")).toBe(true);
  });

  it("isCompatibleVersion rejects different major", () => {
    expect(isCompatibleVersion("2.0")).toBe(false);
    expect(isCompatibleVersion("0.9")).toBe(false);
  });

  it("isCompatibleVersion rejects empty string", () => {
    expect(isCompatibleVersion("")).toBe(false);
  });
});

describe("ulid helpers", () => {
  it("newId without prefix returns a bare ULID", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("newId with prefix returns prefix_ULID", () => {
    const id = newId("foo");
    expect(id.startsWith("foo_")).toBe(true);
  });

  it("each helper emits its prefix", () => {
    expect(newSessionId()).toMatch(/^sess_/);
    expect(newJobId()).toMatch(/^job_/);
    expect(newStreamId()).toMatch(/^str_/);
    expect(newSubscriptionId()).toMatch(/^sub_/);
    expect(newMessageId()).toMatch(/^msg_/);
    expect(newLeaseId()).toMatch(/^lease_/);
    expect(newArtifactId()).toMatch(/^art_/);
  });

  it("newMessageId is monotonic across rapid calls", () => {
    const ids = Array.from({ length: 100 }, () => newMessageId());
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("nowTimestamp emits a parseable ISO 8601 string", () => {
    const ts = nowTimestamp();
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
    expect(ts).toMatch(/Z$/);
  });
});

describe("logger", () => {
  it("rootLogger exists and exposes child", () => {
    expect(typeof rootLogger.child).toBe("function");
  });

  it("sessionLogger creates a child with session_id binding", () => {
    const child = sessionLogger(silentLogger, "sess_test");
    expect(typeof child.info).toBe("function");
  });
});
