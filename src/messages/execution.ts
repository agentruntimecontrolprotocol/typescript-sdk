import { z } from "zod";
import { messageEnvelope } from "../envelope.js";
import { ErrorPayloadSchema } from "../errors.js";

/**
 * Reference to an artifact (§16.1) that may stand in for a value too large to
 * carry inline. Re-declared here to avoid a circular import with artifacts.ts;
 * the canonical definition is in {@link ../messages/artifacts.ts}.
 */
const ArtifactRefShape = z.object({
  artifact_id: z.string().min(1),
  uri: z.string().min(1),
  media_type: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().optional(),
  expires_at: z.string().optional(),
});

// Tool ------------------------------------------------------------------

export const ToolInvokePayloadSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
export type ToolInvokePayload = z.infer<typeof ToolInvokePayloadSchema>;

export const ToolResultPayloadSchema = z
  .object({
    value: z.unknown().optional(),
    result_ref: ArtifactRefShape.optional(),
  })
  .superRefine((p, ctx) => {
    if (p.value === undefined && p.result_ref === undefined) {
      // either is allowed; allow empty result for void-returning tools
      return;
    }
    if (p.value !== undefined && p.result_ref !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool.result must not carry both `value` and `result_ref`",
      });
    }
  });
export type ToolResultPayload = z.infer<typeof ToolResultPayloadSchema>;

export const ToolErrorPayloadSchema = ErrorPayloadSchema;
export type ToolErrorPayload = z.infer<typeof ToolErrorPayloadSchema>;

// Job state --------------------------------------------------------------

export const JOB_STATES = [
  "accepted",
  "queued",
  "running",
  "blocked",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export const JobStateSchema = z.enum(JOB_STATES);
export type JobStateName = z.infer<typeof JobStateSchema>;

// Jobs -------------------------------------------------------------------

export const JobAcceptedPayloadSchema = z.object({
  job_id: z.string().min(1),
  accepted_at: z.string(),
});
export type JobAcceptedPayload = z.infer<typeof JobAcceptedPayloadSchema>;

export const JobStartedPayloadSchema = z.object({
  job_id: z.string().min(1),
  started_at: z.string(),
});
export type JobStartedPayload = z.infer<typeof JobStartedPayloadSchema>;

export const JobProgressPayloadSchema = z.object({
  percent: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  current: z.number().nonnegative().optional(),
  total: z.number().positive().optional(),
});
export type JobProgressPayload = z.infer<typeof JobProgressPayloadSchema>;

export const JobHeartbeatPayloadSchema = z.object({
  sequence: z.number().int().nonnegative(),
  deadline_ms: z.number().int().positive(),
  state: JobStateSchema,
});
export type JobHeartbeatPayload = z.infer<typeof JobHeartbeatPayloadSchema>;

export const JobCheckpointPayloadSchema = z.object({
  checkpoint_id: z.string().min(1),
  snapshot: z.unknown().optional(),
});
export type JobCheckpointPayload = z.infer<typeof JobCheckpointPayloadSchema>;

export const JobCompletedPayloadSchema = z.object({
  result: z.unknown().optional(),
  result_ref: ArtifactRefShape.optional(),
});
export type JobCompletedPayload = z.infer<typeof JobCompletedPayloadSchema>;

export const JobFailedPayloadSchema = ErrorPayloadSchema;
export type JobFailedPayload = z.infer<typeof JobFailedPayloadSchema>;

export const JobCancelledPayloadSchema = z.object({
  reason: z.string().optional(),
  source: z.enum(["client", "runtime", "policy", "timeout"]).optional(),
});
export type JobCancelledPayload = z.infer<typeof JobCancelledPayloadSchema>;

// Out-of-scope payloads (schemas are accepted; runtime handlers throw) ----

export const JobSchedulePayloadSchema = z.object({
  job: z.unknown(),
  when: z.union([
    z.object({ at: z.string() }),
    z.object({ every: z.string() }),
    z.object({ after: z.number().int().nonnegative() }),
  ]),
});

export const WorkflowStartPayloadSchema = z.object({
  workflow: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).optional(),
});
export const WorkflowCompletePayloadSchema = z.object({
  outputs: z.record(z.string(), z.unknown()).optional(),
});

export const AgentDelegatePayloadSchema = z.object({
  target: z.string().min(1),
  task: z.string().min(1),
  context: z
    .object({
      trace_id: z.string().optional(),
      shared_memory_ref: z.string().optional(),
      permissions_inherited: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});
export const AgentHandoffPayloadSchema = z.object({
  to_runtime: z.object({
    kind: z.string().min(1),
    fingerprint: z.string().optional(),
    version: z.string().optional(),
  }),
  job_id: z.string().optional(),
  session_id: z.string().optional(),
  reason: z.string().optional(),
});

// Envelopes --------------------------------------------------------------

export const ToolInvokeEnvelopeSchema = messageEnvelope(
  "tool.invoke",
  ToolInvokePayloadSchema,
).extend({ session_id: z.string().min(1) });
export const ToolResultEnvelopeSchema = messageEnvelope(
  "tool.result",
  ToolResultPayloadSchema,
).extend({ correlation_id: z.string().min(1) });
export const ToolErrorEnvelopeSchema = messageEnvelope("tool.error", ToolErrorPayloadSchema).extend(
  { correlation_id: z.string().min(1) },
);

export const JobAcceptedEnvelopeSchema = messageEnvelope(
  "job.accepted",
  JobAcceptedPayloadSchema,
).extend({ correlation_id: z.string().min(1), job_id: z.string().min(1) });
export const JobStartedEnvelopeSchema = messageEnvelope(
  "job.started",
  JobStartedPayloadSchema,
).extend({ job_id: z.string().min(1) });
export const JobProgressEnvelopeSchema = messageEnvelope(
  "job.progress",
  JobProgressPayloadSchema,
).extend({ job_id: z.string().min(1) });
export const JobHeartbeatEnvelopeSchema = messageEnvelope(
  "job.heartbeat",
  JobHeartbeatPayloadSchema,
).extend({ job_id: z.string().min(1) });
export const JobCheckpointEnvelopeSchema = messageEnvelope(
  "job.checkpoint",
  JobCheckpointPayloadSchema,
).extend({ job_id: z.string().min(1) });
export const JobCompletedEnvelopeSchema = messageEnvelope(
  "job.completed",
  JobCompletedPayloadSchema,
).extend({ job_id: z.string().min(1) });
export const JobFailedEnvelopeSchema = messageEnvelope("job.failed", JobFailedPayloadSchema).extend(
  { job_id: z.string().min(1) },
);
export const JobCancelledEnvelopeSchema = messageEnvelope(
  "job.cancelled",
  JobCancelledPayloadSchema,
).extend({ job_id: z.string().min(1) });

export const JobScheduleEnvelopeSchema = messageEnvelope("job.schedule", JobSchedulePayloadSchema);
export const WorkflowStartEnvelopeSchema = messageEnvelope(
  "workflow.start",
  WorkflowStartPayloadSchema,
);
export const WorkflowCompleteEnvelopeSchema = messageEnvelope(
  "workflow.complete",
  WorkflowCompletePayloadSchema,
);
export const AgentDelegateEnvelopeSchema = messageEnvelope(
  "agent.delegate",
  AgentDelegatePayloadSchema,
);
export const AgentHandoffEnvelopeSchema = messageEnvelope(
  "agent.handoff",
  AgentHandoffPayloadSchema,
);

export const EXECUTION_ENVELOPES = [
  ToolInvokeEnvelopeSchema,
  ToolResultEnvelopeSchema,
  ToolErrorEnvelopeSchema,
  JobAcceptedEnvelopeSchema,
  JobStartedEnvelopeSchema,
  JobProgressEnvelopeSchema,
  JobHeartbeatEnvelopeSchema,
  JobCheckpointEnvelopeSchema,
  JobCompletedEnvelopeSchema,
  JobFailedEnvelopeSchema,
  JobCancelledEnvelopeSchema,
  JobScheduleEnvelopeSchema,
  WorkflowStartEnvelopeSchema,
  WorkflowCompleteEnvelopeSchema,
  AgentDelegateEnvelopeSchema,
  AgentHandoffEnvelopeSchema,
] as const;
