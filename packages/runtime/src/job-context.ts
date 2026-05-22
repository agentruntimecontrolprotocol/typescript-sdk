import { InvalidRequestError } from "@agentruntimecontrolprotocol/core/errors";
import type {
  LogPayload,
  ProgressBody,
  ResultChunkBody,
  StatusBody,
  ThoughtBody,
} from "@agentruntimecontrolprotocol/core/messages";
import { newJobId } from "@agentruntimecontrolprotocol/core/util";

import type { Job } from "./job.js";
import type { JobContext, ResultStream } from "./types.js";

/** Build a {@link JobContext} backed by a {@link Job}. */
export function makeJobContext(job: Job): JobContext {
  return {
    ...jobContextProperties(job),
    ...jobContextEmitters(job),
  };
}

function jobContextProperties(
  job: Job,
): Pick<
  JobContext,
  | "jobId"
  | "sessionId"
  | "agent"
  | "agentVersion"
  | "agentRef"
  | "lease"
  | "leaseConstraints"
  | "budget"
  | "traceId"
  | "signal"
  | "logger"
> {
  return {
    jobId: job.jobId,
    sessionId: job.sessionId,
    agent: job.agent,
    agentVersion: job.agentVersion,
    agentRef: job.agentRef,
    lease: job.lease,
    leaseConstraints: job.leaseConstraints,
    budget: job.budget,
    traceId: job.traceId,
    signal: job.signal,
    logger: job.logger,
  };
}

type JobContextEmitters = Pick<
  JobContext,
  | "log"
  | "thought"
  | "status"
  | "metric"
  | "toolCall"
  | "toolResult"
  | "artifactRef"
  | "delegate"
  | "progress"
  | "resultChunk"
  | "streamResult"
  | "emitEvent"
>;

function jobContextEmitters(job: Job): JobContextEmitters {
  return {
    ...jobBasicEmitters(job),
    ...jobToolingEmitters(job),
    ...jobStreamingEmitters(job),
  };
}

function jobBasicEmitters(
  job: Job,
): Pick<JobContext, "log" | "thought" | "status" | "metric" | "emitEvent"> {
  return {
    async log(level, message, attributes) {
      await job.emitEventKind("log", {
        level,
        message,
        ...(attributes === undefined ? {} : { attributes }),
      } satisfies LogPayload);
    },
    async thought(text) {
      await job.emitEventKind("thought", { text } satisfies ThoughtBody);
    },
    async status(phase, message) {
      const body: StatusBody = {
        phase,
        ...(message === undefined ? {} : { message }),
      };
      await job.emitEventKind("status", body);
    },
    async metric(metric) {
      await job.emitEventKind("metric", metric);
    },
    async emitEvent(kind, body) {
      await job.emitEventKind(kind, body);
    },
  };
}

function jobToolingEmitters(
  job: Job,
): Pick<JobContext, "toolCall" | "toolResult" | "artifactRef" | "delegate"> {
  return {
    async toolCall(body) {
      await job.emitEventKind("tool_call", body);
    },
    async toolResult(body) {
      await job.emitEventKind("tool_result", body);
    },
    async artifactRef(body) {
      await job.emitEventKind("artifact_ref", body);
    },
    async delegate(body) {
      await job.emitEventKind("delegate", body);
    },
  };
}

function jobStreamingEmitters(
  job: Job,
): Pick<JobContext, "progress" | "resultChunk" | "streamResult"> {
  return {
    async progress(current, opts) {
      const body: ProgressBody = {
        current,
        ...(opts?.total === undefined ? {} : { total: opts.total }),
        ...(opts?.units === undefined ? {} : { units: opts.units }),
        ...(opts?.message === undefined ? {} : { message: opts.message }),
      };
      await job.emitEventKind("progress", body);
    },
    async resultChunk(body) {
      await job.emitEventKind("result_chunk", body);
    },
    streamResult(opts) {
      return makeResultStream(job, opts?.resultId);
    },
  };
}

interface ResultStreamState {
  readonly job: Job;
  readonly resultId: string;
  chunkSeq: number;
  finalized: boolean;
}

interface FinalizeOpts {
  encoding?: "utf8" | "base64";
  summary?: string;
  resultSize?: number;
}

function makeResultStream(job: Job, resultIdIn?: string): ResultStream {
  const state: ResultStreamState = {
    job,
    resultId: resultIdIn ?? `res_${newJobId().replace(/^job_/, "")}`,
    chunkSeq: 0,
    finalized: false,
  };
  return {
    resultId: state.resultId,
    write: (data, opts) => writeChunk(state, data, opts?.encoding),
    finalize: (data, opts) => finalizeStream(state, data, opts),
  };
}

async function writeChunk(
  state: ResultStreamState,
  data: string,
  encoding: "utf8" | "base64" | undefined,
): Promise<void> {
  if (state.finalized) {
    throw new InvalidRequestError("ResultStream: cannot write after finalize");
  }
  await state.job.emitEventKind("result_chunk", {
    result_id: state.resultId,
    chunk_seq: state.chunkSeq++,
    data,
    encoding: encoding ?? "utf8",
    more: true,
  } satisfies ResultChunkBody);
}

async function finalizeStream(
  state: ResultStreamState,
  data: string | undefined,
  opts: FinalizeOpts | undefined,
): Promise<void> {
  if (state.finalized) {
    throw new InvalidRequestError("ResultStream: already finalized");
  }
  state.finalized = true;
  await emitFinalChunk(state, data, opts?.encoding);
  await state.job.emitResult({
    final_status: "success",
    result_id: state.resultId,
    ...(opts?.summary === undefined ? {} : { summary: opts.summary }),
    ...(opts?.resultSize === undefined ? {} : { result_size: opts.resultSize }),
  });
}

async function emitFinalChunk(
  state: ResultStreamState,
  data: string | undefined,
  encoding: "utf8" | "base64" | undefined,
): Promise<void> {
  if (data === undefined && state.chunkSeq === 0) return;
  await state.job.emitEventKind("result_chunk", {
    result_id: state.resultId,
    chunk_seq: state.chunkSeq++,
    data: data ?? "",
    encoding: encoding ?? "utf8",
    more: false,
  } satisfies ResultChunkBody);
}
