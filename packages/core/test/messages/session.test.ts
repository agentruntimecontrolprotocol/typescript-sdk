import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  AgentInventoryEntrySchema,
  AuthCredentialSchema,
  CapabilitiesSchema,
  ClientIdentitySchema,
  JobListEntrySchema,
  RuntimeIdentitySchema,
  SessionAckPayloadSchema,
  SessionByePayloadSchema,
  SessionErrorPayloadSchema,
  SessionHelloPayloadSchema,
  SessionJobsPayloadSchema,
  SessionListJobsPayloadSchema,
  SessionPingPayloadSchema,
  SessionPongPayloadSchema,
  SessionResumeSchema,
  SessionWelcomePayloadSchema,
} from "@agentruntimecontrolprotocol/core";

// Pin JSON shapes accepted/rejected by the Effect schemas in session.ts.

const decode =
  <A, I>(s: Schema.Schema<A, I>) =>
  (input: unknown): Promise<A> =>
    Effect.runPromise(Schema.decodeUnknown(s)(input));

describe("AuthCredentialSchema (Effect Schema)", () => {
  it("accepts a bearer credential with a token", async () => {
    const input = { scheme: "bearer" as const, token: "secret" };
    await expect(decode(AuthCredentialSchema)(input)).resolves.toEqual(input);
  });

  it("rejects a bearer credential without a token (v1.1 §6.1 requires token)", async () => {
    const input = { scheme: "bearer" as const };
    await expect(decode(AuthCredentialSchema)(input)).rejects.toThrow();
  });

  it("rejects a bearer credential with an empty token", async () => {
    const input = { scheme: "bearer" as const, token: "" };
    await expect(decode(AuthCredentialSchema)(input)).rejects.toThrow();
  });

  it("rejects unknown auth schemes", async () => {
    await expect(
      decode(AuthCredentialSchema)({ scheme: "oauth2" }),
    ).rejects.toThrow();
  });
});

describe("ClientIdentitySchema / RuntimeIdentitySchema (Effect Schema)", () => {
  it("accepts a full client identity", async () => {
    const input = {
      name: "test-client",
      version: "1.0.0",
      fingerprint: "abc",
      principal: "user@example.com",
    };
    await expect(decode(ClientIdentitySchema)(input)).resolves.toEqual(input);
  });

  it("rejects empty name", async () => {
    await expect(
      decode(ClientIdentitySchema)({ name: "", version: "1" }),
    ).rejects.toThrow();
  });

  it("accepts a minimal runtime identity", async () => {
    const input = { name: "rt", version: "1" };
    await expect(decode(RuntimeIdentitySchema)(input)).resolves.toEqual(input);
  });
});

describe("AgentInventoryEntrySchema (Effect Schema)", () => {
  it("accepts an entry with versions and a default", async () => {
    const input = {
      name: "research",
      versions: ["1.0.0", "2.0.0"],
      default: "2.0.0",
    };
    await expect(decode(AgentInventoryEntrySchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("accepts an empty versions array", async () => {
    const input = { name: "echo", versions: [] };
    await expect(decode(AgentInventoryEntrySchema)(input)).resolves.toEqual(
      input,
    );
  });
});

describe("CapabilitiesSchema (Effect Schema)", () => {
  it("accepts a v1.0 string-array agents advertisement", async () => {
    const input = {
      encodings: ["json"],
      agents: ["echo", "research"],
    };
    await expect(decode(CapabilitiesSchema)(input)).resolves.toEqual(input);
  });

  it("accepts a v1.1 rich agents advertisement with features", async () => {
    const input = {
      encodings: ["json"],
      agents: [{ name: "research", versions: ["1.0.0"], default: "1.0.0" }],
      features: ["heartbeat", "subscribe"],
    };
    await expect(decode(CapabilitiesSchema)(input)).resolves.toEqual(input);
  });

  it("accepts an empty object", async () => {
    await expect(decode(CapabilitiesSchema)({})).resolves.toEqual({});
  });
});

describe("SessionResumeSchema (Effect Schema)", () => {
  it("accepts a v1.0 resume block", async () => {
    const input = {
      session_id: "sess_01",
      resume_token: "tok_01",
      last_event_seq: 42,
    };
    await expect(decode(SessionResumeSchema)(input)).resolves.toEqual(input);
  });

  it("rejects negative last_event_seq", async () => {
    await expect(
      decode(SessionResumeSchema)({
        session_id: "s",
        resume_token: "t",
        last_event_seq: -1,
      }),
    ).rejects.toThrow();
  });
});

describe("SessionHelloPayloadSchema (Effect Schema)", () => {
  it("accepts a minimal hello", async () => {
    const input = {
      client: { name: "c", version: "1" },
      auth: { scheme: "bearer" as const, token: "tok" },
    };
    await expect(decode(SessionHelloPayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("accepts a full hello with capabilities and resume", async () => {
    const input = {
      client: { name: "c", version: "1" },
      auth: { scheme: "bearer" as const, token: "tok" },
      capabilities: { encodings: ["json"], features: ["heartbeat"] },
      resume: {
        session_id: "sess_01",
        resume_token: "rt_01",
        last_event_seq: 7,
      },
    };
    await expect(decode(SessionHelloPayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });
});

describe("SessionWelcomePayloadSchema (Effect Schema)", () => {
  it("accepts a v1.0 welcome", async () => {
    const input = {
      runtime: { name: "rt", version: "1" },
      resume_token: "rt_01",
      resume_window_sec: 300,
      capabilities: { encodings: ["json"] },
    };
    await expect(decode(SessionWelcomePayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("accepts the v1.1 heartbeat_interval_sec", async () => {
    const input = {
      runtime: { name: "rt", version: "1" },
      resume_token: "rt_01",
      resume_window_sec: 300,
      heartbeat_interval_sec: 30,
      capabilities: { features: ["heartbeat"] },
    };
    await expect(decode(SessionWelcomePayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("rejects non-positive resume_window_sec", async () => {
    await expect(
      decode(SessionWelcomePayloadSchema)({
        runtime: { name: "rt", version: "1" },
        resume_token: "rt",
        resume_window_sec: 0,
        capabilities: {},
      }),
    ).rejects.toThrow();
  });
});

describe("SessionErrorPayloadSchema (Effect Schema)", () => {
  it("accepts a §12 error payload", async () => {
    const input = {
      code: "INVALID_REQUEST" as const,
      message: "bad request",
    };
    await expect(decode(SessionErrorPayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("rejects unknown error codes", async () => {
    await expect(
      decode(SessionErrorPayloadSchema)({ code: "NOPE", message: "x" }),
    ).rejects.toThrow();
  });
});

describe("SessionByePayloadSchema (Effect Schema)", () => {
  it("accepts an empty bye", async () => {
    await expect(decode(SessionByePayloadSchema)({})).resolves.toEqual({});
  });

  it("accepts a reason", async () => {
    const input = { reason: "client closed" };
    await expect(decode(SessionByePayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });
});

describe("SessionPingPayloadSchema / SessionPongPayloadSchema (Effect Schema)", () => {
  it("accepts a ping body", async () => {
    const input = { nonce: "n-1", sent_at: "2025-01-01T00:00:00Z" };
    await expect(decode(SessionPingPayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("accepts a pong body", async () => {
    const input = { ping_nonce: "n-1", received_at: "2025-01-01T00:00:01Z" };
    await expect(decode(SessionPongPayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("rejects an empty nonce on ping", async () => {
    await expect(
      decode(SessionPingPayloadSchema)({ nonce: "", sent_at: "x" }),
    ).rejects.toThrow();
  });
});

describe("SessionAckPayloadSchema (Effect Schema)", () => {
  it("accepts a non-negative seq", async () => {
    await expect(
      decode(SessionAckPayloadSchema)({ last_processed_seq: 0 }),
    ).resolves.toEqual({ last_processed_seq: 0 });
  });

  it("rejects negative seq", async () => {
    await expect(
      decode(SessionAckPayloadSchema)({ last_processed_seq: -1 }),
    ).rejects.toThrow();
  });
});

describe("SessionListJobsPayloadSchema (Effect Schema)", () => {
  it("accepts an empty body", async () => {
    await expect(decode(SessionListJobsPayloadSchema)({})).resolves.toEqual({});
  });

  it("accepts the v1.1 §6.6 filter example", async () => {
    const input = {
      filter: { status: ["running"], agent: "research" },
      limit: 50,
      cursor: null,
    };
    await expect(decode(SessionListJobsPayloadSchema)(input)).resolves.toEqual(
      input,
    );
  });

  it("rejects non-positive limit", async () => {
    await expect(
      decode(SessionListJobsPayloadSchema)({ limit: 0 }),
    ).rejects.toThrow();
  });
});

describe("JobListEntrySchema / SessionJobsPayloadSchema (Effect Schema)", () => {
  it("accepts a §6.6 jobs response with one entry", async () => {
    const entry = {
      job_id: "job_01",
      agent: "research",
      status: "running",
      lease: { "tool.call": ["web.search"] },
      created_at: "2025-01-01T00:00:00Z",
      last_event_seq: 3,
    };
    await expect(decode(JobListEntrySchema)(entry)).resolves.toEqual(entry);

    const payload = {
      request_id: "req-1",
      jobs: [entry],
      next_cursor: null,
    };
    await expect(decode(SessionJobsPayloadSchema)(payload)).resolves.toEqual(
      payload,
    );
  });

  it("rejects empty job_id", async () => {
    await expect(
      decode(JobListEntrySchema)({
        job_id: "",
        agent: "a",
        status: "running",
        lease: {},
        created_at: "x",
        last_event_seq: 0,
      }),
    ).rejects.toThrow();
  });
});
