import type { JobId, TraceId } from "@agentruntimecontrolprotocol/core";
import { InvalidRequestError } from "@agentruntimecontrolprotocol/core/errors";
import type {
  JobAcceptedPayload,
  JobEventPayload,
  JobResultPayload,
  Lease,
  LeaseConstraints,
  ResultChunkBody,
  Credential,
} from "@agentruntimecontrolprotocol/core/messages";
import type { Deferred } from "@agentruntimecontrolprotocol/core/util";

import type { JobHandle } from "./types.js";

export interface InvocationState {
  jobId: JobId | null;
  lease: Lease | null;
  agent: string | undefined;
  leaseConstraints: LeaseConstraints | undefined;
  budget: Record<string, number> | undefined;
  credentials: Credential[] | undefined;
  traceId: TraceId | undefined;
  events: JobEventPayload[];
  acceptance: Deferred<JobAcceptedPayload>;
  completion: Deferred<JobResultPayload>;
  /** v1.1 §8.4 — accumulated result chunks, keyed by result_id. */
  chunks: Map<string, ResultChunkBody[]>;
}

export function makeHandleFromInvocation(inv: InvocationState): JobHandle {
  return {
    get jobId(): JobId {
      return inv.jobId ?? "";
    },
    get lease(): Lease {
      return inv.lease ?? {};
    },
    get agent(): string | undefined {
      return inv.agent;
    },
    get leaseConstraints(): LeaseConstraints | undefined {
      return inv.leaseConstraints;
    },
    get budget(): Record<string, number> | undefined {
      return inv.budget;
    },
    get credentials(): readonly Credential[] | undefined {
      return inv.credentials;
    },
    get traceId(): TraceId | undefined {
      return inv.traceId;
    },
    done: inv.completion.promise,
    collectChunks: () => collectChunks(inv),
  };
}

async function collectChunks(inv: InvocationState): Promise<Buffer | string> {
  const result = await inv.completion.promise;
  const resultId = result.result_id;
  if (resultId === undefined) {
    throw new InvalidRequestError(
      "job.result has no result_id; no chunks to collect",
    );
  }
  const chunks = inv.chunks.get(resultId);
  if (chunks === undefined || chunks.length === 0) return "";
  const sorted = chunks.toSorted((a, b) => a.chunk_seq - b.chunk_seq);
  // Per v1.1 §8.4 each chunk carries its own `encoding`. A stream that mixes
  // `utf8` text and `base64` binary chunks is valid on the wire, so decode
  // per chunk rather than sampling encoding from the first.
  const allUtf8 = sorted.every((c) => c.encoding === "utf8");
  if (allUtf8) {
    return sorted.map((c) => c.data).join("");
  }
  return Buffer.concat(
    sorted.map((c) =>
      c.encoding === "base64"
        ? Buffer.from(c.data, "base64")
        : Buffer.from(c.data, "utf8"),
    ),
  );
}
