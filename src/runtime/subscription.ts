import { type BaseEnvelope, buildEnvelope, type Priority } from "../envelope.js";
import { PermissionDeniedError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { SubscribeFilter, SubscribePayload } from "../messages/index.js";
import type { EventLog, EventLogFilter } from "../store/eventlog.js";
import { newMessageId, newSubscriptionId, nowTimestamp } from "../util/ulid.js";

const PRIORITY_RANK: Readonly<Record<Priority, number>> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

function priorityRank(p: Priority): number {
  return PRIORITY_RANK[p];
}

/** A subscriber's own entitlements, used to authorize filters (§13.2). */
export interface SubscriptionEntitlements {
  /** Session ids the subscriber may observe. */
  readonly sessions: readonly string[];
}

/** A live subscription registered with the {@link SubscriptionManager}. */
export interface Subscription {
  readonly id: string;
  readonly ownerSessionId: string;
  readonly filter: CompiledFilter;
  state: "backfilling" | "live" | "closed";
  /** Function to deliver an envelope to the subscriber. */
  readonly emit: (event: BaseEnvelope) => Promise<void>;
}

/**
 * Compiled, authorization-checked filter. The set of session ids has been
 * narrowed to those the subscriber is allowed to observe.
 */
export interface CompiledFilter {
  readonly session_ids: readonly string[];
  readonly job_ids: readonly string[];
  readonly stream_ids: readonly string[];
  readonly trace_ids: readonly string[];
  readonly types: readonly string[];
  readonly minPriorityRank: number; // -1 means no minimum
}

/**
 * In-process subscription manager (§13).
 *
 * - Compiles filters with authorization checks.
 * - Pulls backfill from the event log per `since.after_message_id`.
 * - Emits a synthetic `subscription.backfill_complete` boundary marker.
 * - Live-tails new envelopes published via {@link publish}.
 */
export class SubscriptionManager {
  private readonly subs = new Map<string, Subscription>();

  public constructor(
    private readonly eventLog: EventLog,
    private readonly logger: Logger,
  ) {}

  public get size(): number {
    return this.subs.size;
  }

  public list(): readonly Subscription[] {
    return [...this.subs.values()];
  }

  /**
   * Register a new subscription synchronously and return it. The runtime
   * SHOULD send `subscribe.accepted` with the returned id immediately, and
   * then call {@link runBackfill} to populate any historical events. This
   * ordering guarantees the client has wired its handler before backfill
   * envelopes arrive.
   */
  public create(args: {
    ownerSessionId: string;
    entitlements: SubscriptionEntitlements;
    payload: SubscribePayload;
    emit: (event: BaseEnvelope) => Promise<void>;
  }): Subscription {
    const filter = compileAndAuthorize(args.payload.filter, args.entitlements);
    const sub: Subscription = {
      id: newSubscriptionId(),
      ownerSessionId: args.ownerSessionId,
      filter,
      state: args.payload.since !== undefined ? "backfilling" : "live",
      emit: args.emit,
    };
    this.subs.set(sub.id, sub);
    return sub;
  }

  /**
   * Run the backfill phase for a subscription. Reads from the event log,
   * delivers matching envelopes, then emits the synthetic
   * `subscription.backfill_complete` boundary marker per §13.3 and
   * transitions the subscription to `live`.
   */
  public async runBackfill(sub: Subscription, afterId: string | undefined): Promise<void> {
    if (sub.state !== "backfilling") return;
    await this.runBackfillInner(sub, afterId);
    sub.state = "live";
  }

  public unsubscribe(id: string): boolean {
    const sub = this.subs.get(id);
    if (sub === undefined) return false;
    sub.state = "closed";
    this.subs.delete(id);
    return true;
  }

  /**
   * Fan an outbound envelope to every matching live subscription. Called by
   * the runtime on every envelope appended to the event log.
   */
  public async publish(env: BaseEnvelope): Promise<void> {
    for (const sub of this.subs.values()) {
      if (sub.state !== "live") continue;
      if (!matchesFilter(env, sub.filter)) continue;
      try {
        await this.deliver(sub, env);
      } catch (err) {
        this.logger.error({ err, subscription_id: sub.id }, "subscription emit failed");
      }
    }
  }

  // -------------------------------------------------------------------

  private async runBackfillInner(sub: Subscription, afterId: string | undefined): Promise<void> {
    const filter = sub.filter;
    const sessionId = filter.session_ids[0];
    if (sessionId === undefined) {
      // No session id → no backfill scope.
      await this.emitBackfillComplete(sub);
      return;
    }
    const elFilter: EventLogFilter = {
      session_id: sessionId,
      ...(filter.job_ids.length === 1 && filter.job_ids[0] !== undefined
        ? { job_id: filter.job_ids[0] }
        : {}),
      ...(filter.trace_ids.length === 1 && filter.trace_ids[0] !== undefined
        ? { trace_id: filter.trace_ids[0] }
        : {}),
      ...(filter.types.length > 0 ? { types: filter.types } : {}),
      ...(afterId !== undefined ? { after_id: afterId } : {}),
      limit: 10_000,
    };
    const rows = await this.eventLog.query(elFilter);
    for (const row of rows) {
      if (!matchesFilter(row, filter)) continue;
      await this.deliver(sub, row);
    }
    await this.emitBackfillComplete(sub);
  }

  private async deliver(sub: Subscription, event: BaseEnvelope): Promise<void> {
    const wrapper = buildEnvelope({
      id: newMessageId(),
      type: "subscribe.event" as const,
      timestamp: nowTimestamp(),
      payload: { event },
      optional: { session_id: sub.ownerSessionId, subscription_id: sub.id },
    });
    await sub.emit(wrapper);
  }

  private async emitBackfillComplete(sub: Subscription): Promise<void> {
    const synthetic = buildEnvelope({
      id: newMessageId(),
      type: "event.emit" as const,
      timestamp: nowTimestamp(),
      payload: { name: "subscription.backfill_complete" },
      optional: { session_id: sub.ownerSessionId, subscription_id: sub.id },
    });
    await this.deliver(sub, synthetic);
  }
}

function compileAndAuthorize(
  filter: SubscribeFilter,
  entitlements: SubscriptionEntitlements,
): CompiledFilter {
  // Authorize session_ids: must all be in entitlements.sessions.
  const requestedSessions = filter.session_id ?? [];
  if (requestedSessions.length === 0) {
    // Default to the subscriber's first entitled session.
    const firstSession = entitlements.sessions[0];
    if (firstSession === undefined) {
      throw new PermissionDeniedError(
        "Subscription has no session scope and the subscriber has no entitled sessions",
      );
    }
    return {
      session_ids: [firstSession],
      job_ids: filter.job_id ?? [],
      stream_ids: filter.stream_id ?? [],
      trace_ids: filter.trace_id ?? [],
      types: filter.types ?? [],
      minPriorityRank: filter.min_priority !== undefined ? priorityRank(filter.min_priority) : -1,
    };
  }
  for (const sid of requestedSessions) {
    if (!entitlements.sessions.includes(sid)) {
      throw new PermissionDeniedError(`Subscriber not entitled to observe session "${sid}"`, {
        details: { session_id: sid },
      });
    }
  }
  return {
    session_ids: requestedSessions,
    job_ids: filter.job_id ?? [],
    stream_ids: filter.stream_id ?? [],
    trace_ids: filter.trace_id ?? [],
    types: filter.types ?? [],
    minPriorityRank: filter.min_priority !== undefined ? priorityRank(filter.min_priority) : -1,
  };
}

function matchesFilter(env: BaseEnvelope, filter: CompiledFilter): boolean {
  if (filter.session_ids.length > 0) {
    if (env.session_id === undefined) return false;
    if (!filter.session_ids.includes(env.session_id)) return false;
  }
  if (filter.job_ids.length > 0) {
    if (env.job_id === undefined) return false;
    if (!filter.job_ids.includes(env.job_id)) return false;
  }
  if (filter.stream_ids.length > 0) {
    if (env.stream_id === undefined) return false;
    if (!filter.stream_ids.includes(env.stream_id)) return false;
  }
  if (filter.trace_ids.length > 0) {
    if (env.trace_id === undefined) return false;
    if (!filter.trace_ids.includes(env.trace_id)) return false;
  }
  if (filter.types.length > 0) {
    if (!filter.types.includes(env.type)) return false;
  }
  if (filter.minPriorityRank >= 0) {
    const p: Priority = env.priority ?? "normal";
    if (priorityRank(p) < filter.minPriorityRank) return false;
  }
  return true;
}
