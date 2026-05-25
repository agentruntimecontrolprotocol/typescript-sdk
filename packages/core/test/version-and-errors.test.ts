import { describe, expect, it } from "vitest";

import {
  ARCPError,
  ERROR_CODES,
  InternalError,
  InvalidRequestError,
  isErrorCode,
  isRetryableByDefault,
  ResumeWindowExpiredError,
} from "../src/errors.js";
import { PROTOCOL_VERSION, V1_1_FEATURES, intersectFeatures, isCompatibleVersion } from "../src/version.js";

describe("version helpers", () => {
  it("matches and intersects features", () => {
    expect(isCompatibleVersion(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleVersion("0.0")).toBe(false);
    expect(intersectFeatures(["ack", "progress"], ["progress", "subscribe"])).toEqual(["progress"]);
  });

  it("exposes v1.1 feature names", () => {
    expect(V1_1_FEATURES).toContain("ack");
  });
});

describe("error helpers", () => {
  it("recognizes canonical error codes and retryability", () => {
    expect(isErrorCode(ERROR_CODES[0])).toBe(true);
    expect(isErrorCode("not-an-error")).toBe(false);
    expect(isRetryableByDefault("INTERNAL_ERROR")).toBe(true);
    expect(isRetryableByDefault("PERMISSION_DENIED")).toBe(false);
  });

  it("serializes and rehydrates ARCP errors", () => {
    const err = new InvalidRequestError("bad", { details: { x: 1 } });
    const roundTrip = ARCPError.fromPayload(err.toPayload());
    expect(roundTrip.code).toBe("INVALID_REQUEST");
    expect(roundTrip.details).toEqual({ x: 1 });
    expect(new InternalError("boom").retryable).toBe(true);
    expect(new ResumeWindowExpiredError("expired").code).toBe("RESUME_WINDOW_EXPIRED");
  });
});
