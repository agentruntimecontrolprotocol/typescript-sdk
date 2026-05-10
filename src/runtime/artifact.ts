import { createHash } from "node:crypto";
import { InvalidArgumentError, NotFoundError } from "../errors.js";
import type { ArtifactPutPayload, ArtifactRef, ArtifactReleasePayload } from "../messages/index.js";
import { newArtifactId } from "../util/ulid.js";

interface StoredArtifact {
  readonly sessionId: string;
  readonly artifactId: string;
  readonly mediaType: string;
  readonly data: Buffer;
  readonly sha256: string;
  expiresAtMs: number;
}

export interface ArtifactStoreOptions {
  /** Default TTL for stored artifacts in seconds. Default 3600 (1 hour). */
  defaultTtlSeconds?: number;
  /** Maximum TTL clients may request. Default 86400 (24 hours). */
  maxTtlSeconds?: number;
}

/**
 * In-memory artifact store (§16). Inline base64 only for v0.1; sidecar binary
 * frames are out of scope. URI scheme `arcp://session/<sid>/artifact/<aid>`
 * is opaque metadata — fetch always returns the inline content.
 *
 * Retention is enforced by a periodic sweep started in {@link startSweep}.
 */
export class ArtifactStore {
  private readonly artifacts = new Map<string, StoredArtifact>();
  private readonly defaultTtlMs: number;
  private readonly maxTtlMs: number;
  private sweepCancel: (() => void) | null = null;

  public constructor(opts: ArtifactStoreOptions = {}) {
    this.defaultTtlMs = (opts.defaultTtlSeconds ?? 3600) * 1000;
    this.maxTtlMs = (opts.maxTtlSeconds ?? 86_400) * 1000;
  }

  public get size(): number {
    return this.artifacts.size;
  }

  /** Store an artifact and return its `artifact.ref` payload. */
  public put(sessionId: string, payload: ArtifactPutPayload): ArtifactRef {
    if (payload.data === undefined) {
      throw new InvalidArgumentError(
        "artifact.put requires inline `data` (sidecar frames not supported in v0.1)",
      );
    }
    const encoding = payload.encoding ?? "base64";
    if (encoding !== "base64") {
      throw new InvalidArgumentError(`Unsupported encoding "${encoding}"; v0.1 supports base64`);
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(payload.data, "base64");
    } catch (cause) {
      throw new InvalidArgumentError("artifact.put data is not valid base64", {
        cause: cause instanceof Error ? cause : undefined,
      });
    }
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const ttlMs = Math.min(
      payload.ttl_seconds !== undefined ? payload.ttl_seconds * 1000 : this.defaultTtlMs,
      this.maxTtlMs,
    );
    const artifactId = payload.artifact_id ?? newArtifactId();
    const expiresAtMs = Date.now() + ttlMs;
    this.artifacts.set(artifactId, {
      sessionId,
      artifactId,
      mediaType: payload.media_type,
      data: buffer,
      sha256,
      expiresAtMs,
    });
    return {
      artifact_id: artifactId,
      uri: `arcp://session/${sessionId}/artifact/${artifactId}`,
      media_type: payload.media_type,
      size: buffer.byteLength,
      sha256,
      expires_at: new Date(expiresAtMs).toISOString(),
    };
  }

  /** Fetch an artifact's data and ref. Throws {@link NotFoundError} if missing or expired. */
  public fetch(sessionId: string, artifactId: string): { ref: ArtifactRef; data: Buffer } {
    const record = this.artifacts.get(artifactId);
    if (record === undefined || record.expiresAtMs <= Date.now()) {
      this.artifacts.delete(artifactId);
      throw new NotFoundError(`Artifact "${artifactId}" not found or expired`);
    }
    if (record.sessionId !== sessionId) {
      throw new NotFoundError(`Artifact "${artifactId}" not found or expired`);
    }
    return {
      ref: {
        artifact_id: record.artifactId,
        uri: `arcp://session/${sessionId}/artifact/${record.artifactId}`,
        media_type: record.mediaType,
        size: record.data.byteLength,
        sha256: record.sha256,
        expires_at: new Date(record.expiresAtMs).toISOString(),
      },
      data: record.data,
    };
  }

  /** Release an artifact (delete). Idempotent. */
  public release(payload: ArtifactReleasePayload): boolean {
    return this.artifacts.delete(payload.artifact_id);
  }

  /**
   * Run a single retention sweep. Returns the number of artifacts removed.
   * Called by {@link startSweep} on a timer.
   */
  public sweepNow(): number {
    let removed = 0;
    const now = Date.now();
    for (const [id, record] of this.artifacts.entries()) {
      if (record.expiresAtMs <= now) {
        this.artifacts.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Start the retention sweep on `intervalMs`. Returns a cancel function. */
  public startSweep(intervalMs: number = 60_000): () => void {
    if (this.sweepCancel !== null) return this.sweepCancel;
    const timer = setInterval(() => {
      try {
        this.sweepNow();
      } catch {
        /* ignored */
      }
    }, intervalMs);
    timer.unref();
    this.sweepCancel = () => {
      clearInterval(timer);
      this.sweepCancel = null;
    };
    return this.sweepCancel;
  }

  /** Stop the retention sweep. Idempotent. */
  public stopSweep(): void {
    if (this.sweepCancel !== null) {
      this.sweepCancel();
    }
  }
}
