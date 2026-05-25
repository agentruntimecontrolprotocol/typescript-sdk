import { describe, expect, it } from "vitest";

import { newId, newJobId, newMessageId, newSessionId, nowTimestamp } from "../src/util/ulid.js";

describe("ulid helpers", () => {
  it("prefixes ids correctly", () => {
    expect(newSessionId().startsWith("sess_")).toBe(true);
    expect(newJobId().startsWith("job_")).toBe(true);
    expect(newMessageId().startsWith("msg_")).toBe(true);
    expect(newId("custom").startsWith("custom_")).toBe(true);
  });

  it("returns an ISO timestamp", () => {
    expect(Number.isNaN(Date.parse(nowTimestamp()))).toBe(false);
  });
});
