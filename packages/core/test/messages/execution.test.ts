import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  EnvelopeSchema,
  JobBudgetSchema,
  JobCancelledPayloadSchema,
  JobCancelPayloadSchema,
  JobErrorFinalStatusSchema,
  JobErrorPayloadSchema,
  JobResultPayloadSchema,
  JobStateSchema,
  JobSubmitPayloadSchema,
  JobUnsubscribePayloadSchema,
} from "@agentruntimecontrolprotocol/core";

// Pin the JSON shapes accepted/rejected by the Effect schemas in execution.ts.

const decode =
  <A, I>(s: Schema.Schema<A, I>) =>
  (input: unknown): Promise<A> =>
    Effect.runPromise(Schema.decodeUnknown(s)(input));

describe("JobSubmitPayloadSchema (Effect Schema)", () => {
  it("accepts the docs/guides/jobs.md submit example", async () => {
    const input = {
      agent: "research",
      input: { query: "ARCP spec" },
      lease_request: { "tool.call": ["web.search"] },
      max_runtime_sec: 60,
    };
    await expect(decode(JobSubmitPayloadSchema)(input)).resolves.toEqual(input);
  });

  it("accepts a minimal submit (agent + input only)", async () => {
    const input = { agent: "echo", input: { msg: "hi" } };
    await expect(decode(JobSubmitPayloadSchema)(input)).resolves.toEqual(input);
  });

  it("rejects empty agent (zod parity: .min(1))", async () => {
    await expect(
      decode(JobSubmitPayloadSchema)({ agent: "", input: null }),
    ).rejects.toThrow();
  });

  it("rejects max_runtime_sec <= 0", async () => {
    await expect(
      decode(JobSubmitPayloadSchema)({
        agent: "a",
        input: null,
        max_runtime_sec: 0,
      }),
    ).rejects.toThrow();
  });
});

describe("JobBudgetSchema (Effect Schema)", () => {
  it("accepts a multi-currency budget", async () => {
    const input = { USD: 5.25, credits: 100 };
    await expect(decode(JobBudgetSchema)(input)).resolves.toEqual(input);
  });

  it("accepts an empty record", async () => {
    await expect(decode(JobBudgetSchema)({})).resolves.toEqual({});
  });

  it("rejects empty currency keys rather than silently dropping them (§9.6)", async () => {
    // A malformed budget must fail decode, not yield a reduced (no-currency)
    // budget that would silently disable budget enforcement.
    await expect(decode(JobBudgetSchema)({ "": 1 })).rejects.toThrow();
  });

  it("rejects non-numeric values", async () => {
    await expect(
      decode(JobBudgetSchema)({ USD: "not a number" }),
    ).rejects.toThrow();
  });
});

describe("JobCancelPayloadSchema (Effect Schema)", () => {
  it("accepts an empty body", async () => {
    await expect(decode(JobCancelPayloadSchema)({})).resolves.toEqual({});
  });

  it("accepts a reason", async () => {
    const input = { reason: "client requested" };
    await expect(decode(JobCancelPayloadSchema)(input)).resolves.toEqual(input);
  });
});

describe("JobCancelledPayloadSchema (§7.4, issue #147)", () => {
  it("accepts an empty body", async () => {
    await expect(decode(JobCancelledPayloadSchema)({})).resolves.toEqual({});
  });

  it("accepts a reason", async () => {
    const input = { reason: "client requested" };
    await expect(decode(JobCancelledPayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("round-trips a job.cancelled envelope through the union", async () => {
    const env = {
      arcp: "1.1",
      id: "msg_cancelled_1",
      type: "job.cancelled",
      session_id: "sess_1",
      job_id: "job_1",
      payload: { reason: "client requested" },
    };
    const decoded = await decode(EnvelopeSchema)(env);
    expect(decoded.type).toBe("job.cancelled");
  });
});

describe("JobStateSchema (Effect Schema)", () => {
  it("accepts every JOB_STATES member", async () => {
    for (const state of [
      "pending",
      "running",
      "success",
      "error",
      "cancelled",
      "timed_out",
    ] as const) {
      await expect(decode(JobStateSchema)(state)).resolves.toBe(state);
    }
  });

  it("rejects unknown states", async () => {
    await expect(decode(JobStateSchema)("paused")).rejects.toThrow();
  });
});

describe("JobResultPayloadSchema (Effect Schema)", () => {
  it("accepts the v1.0 inline result", async () => {
    const input = {
      final_status: "success" as const,
      summary: "ok",
      result: { ok: true },
    };
    await expect(decode(JobResultPayloadSchema)(input)).resolves.toEqual(input);
  });

  it("accepts the v1.1 §8.4 streamed-result terminator", async () => {
    const input = {
      final_status: "success" as const,
      result_id: "r-1",
      result_size: 1024,
    };
    await expect(decode(JobResultPayloadSchema)(input)).resolves.toEqual(input);
  });

  it("rejects final_status != success", async () => {
    await expect(
      decode(JobResultPayloadSchema)({ final_status: "error" }),
    ).rejects.toThrow();
  });

  it("rejects negative result_size", async () => {
    await expect(
      decode(JobResultPayloadSchema)({
        final_status: "success",
        result_id: "r-1",
        result_size: -1,
      }),
    ).rejects.toThrow();
  });
});

describe("JobErrorPayloadSchema (Effect Schema)", () => {
  it("accepts an error variant", async () => {
    const input = {
      final_status: "error" as const,
      code: "INTERNAL_ERROR" as const,
      message: "boom",
      retryable: true,
    };
    await expect(decode(JobErrorPayloadSchema)(input)).resolves.toEqual(input);
  });

  it("accepts cancelled / timed_out final_status", async () => {
    for (const final_status of ["cancelled", "timed_out"] as const) {
      const input = {
        final_status,
        code: "CANCELLED" as const,
        message: "x",
        retryable: false,
      };
      await expect(decode(JobErrorPayloadSchema)(input)).resolves.toEqual(
        input,
      );
    }
  });

  it("rejects unknown error codes (zod parity: enum)", async () => {
    await expect(
      decode(JobErrorPayloadSchema)({
        final_status: "error",
        code: "NOT_A_CODE",
        message: "x",
      }),
    ).rejects.toThrow();
  });

  it("rejects empty message", async () => {
    await expect(
      decode(JobErrorPayloadSchema)({
        final_status: "error",
        code: "INTERNAL_ERROR",
        message: "",
      }),
    ).rejects.toThrow();
  });
});

describe("JobErrorFinalStatusSchema (Effect Schema)", () => {
  it("accepts each terminal failure status", async () => {
    for (const status of ["error", "cancelled", "timed_out"] as const) {
      await expect(decode(JobErrorFinalStatusSchema)(status)).resolves.toBe(
        status,
      );
    }
  });

  it("rejects success (which belongs to JobResultPayload)", async () => {
    await expect(
      decode(JobErrorFinalStatusSchema)("success"),
    ).rejects.toThrow();
  });
});

describe("JobUnsubscribePayloadSchema (Effect Schema)", () => {
  it("accepts a job_id-only body", async () => {
    const input = { job_id: "job_01" };
    await expect(decode(JobUnsubscribePayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("rejects empty job_id", async () => {
    await expect(
      decode(JobUnsubscribePayloadSchema)({ job_id: "" }),
    ).rejects.toThrow();
  });
});
