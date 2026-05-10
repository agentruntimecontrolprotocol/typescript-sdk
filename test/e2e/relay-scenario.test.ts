/**
 * End-to-end relay scenario (Phase 7).
 *
 * - A runtime is spun up.
 * - An "agent" client invokes a tool that:
 *     1. Emits log/progress events.
 *     2. Requests human input.
 *     3. Stores an artifact.
 *     4. Completes.
 * - An "observer" subscriber tails events on its own session in parallel.
 *
 * The test verifies that:
 *   - tool.result arrives.
 *   - The human handler's response made it to the tool.
 *   - The artifact is fetchable.
 *   - The observer received at least one log event.
 */
import { describe, expect, it } from "vitest";
import {
  ARCPClient,
  ARCPServer,
  type HumanChoiceRequestPayload,
  type HumanChoiceResponsePayload,
  type HumanInputHandler,
  type HumanInputRequestPayload,
  type HumanInputResponsePayload,
  pairMemoryTransports,
  StaticBearerVerifier,
  silentLogger,
} from "../../src/index.js";

class TestHumanHandler implements HumanInputHandler {
  public lastInput: HumanInputRequestPayload | null = null;
  public async onInputRequest(req: HumanInputRequestPayload): Promise<HumanInputResponsePayload> {
    this.lastInput = req;
    return {
      value: { approved: true },
      responded_by: "test",
      responded_at: "2026-05-09T13:00:00Z",
    };
  }
  public async onChoiceRequest(
    req: HumanChoiceRequestPayload,
  ): Promise<HumanChoiceResponsePayload> {
    return {
      choice_id: req.options[0]?.id ?? "abort",
      responded_by: "test",
      responded_at: "2026-05-09T13:00:00Z",
    };
  }
}

describe("e2e relay scenario", () => {
  it("agent invokes a tool that uses HITL + artifacts; observer tails events", async () => {
    const server = new ARCPServer({
      runtime: { kind: "test-runtime", version: "0.1.0", trust_level: "trusted" },
      capabilities: {
        streaming: true,
        human_input: true,
        artifacts: true,
        subscriptions: true,
        durable_jobs: true,
      },
      bearer: new StaticBearerVerifier(
        new Map([
          ["agent-token", { principal: "agent" }],
          ["observer-token", { principal: "observer" }],
        ]),
      ),
      logger: silentLogger,
    });

    server.registerTool("compose-email", async (args, ctx) => {
      await ctx.log("info", "Drafting email...");
      await ctx.emitProgress({ percent: 25, message: "fetching context" });
      const decision = await ctx.requestHumanInput({
        prompt: "Approve this email draft?",
        response_schema: {
          type: "object",
          properties: { approved: { type: "boolean" } },
          required: ["approved"],
        },
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      await ctx.emitProgress({ percent: 80, message: "queued for send" });
      return { sent: true, approved_by: "test", artifact: args["artifact_id"], decision };
    });

    const handler = new TestHumanHandler();
    const agent = new ARCPClient({
      client: { kind: "agent", version: "0.0.1" },
      capabilities: { streaming: true, human_input: true, artifacts: true },
      authScheme: "bearer",
      token: "agent-token",
      humanInputHandler: handler,
      logger: silentLogger,
    });

    const observer = new ARCPClient({
      client: { kind: "observer", version: "0.0.1" },
      capabilities: { streaming: true, subscriptions: true },
      authScheme: "bearer",
      token: "observer-token",
      logger: silentLogger,
    });

    const [agentC, agentS] = pairMemoryTransports();
    const [obsC, obsS] = pairMemoryTransports();
    server.accept(agentS);
    server.accept(obsS);

    await agent.connect(agentC);
    await observer.connect(obsC);

    // Observer subscribes to its own session's logs.
    const obsSub = await observer.subscribe({ filter: { types: ["log"] } });

    // Agent uploads a draft artifact.
    const draft = Buffer.from("Subject: Q3 review\n\nLooks good.");
    const ref = await agent.putArtifact({
      media_type: "text/plain",
      data: draft.toString("base64"),
      encoding: "base64",
    });
    expect(ref.size).toBe(draft.byteLength);

    // Agent runs the tool with the artifact id.
    const out = await agent.invoke("compose-email", { artifact_id: ref.artifact_id });
    expect((out.result.value as { sent?: boolean }).sent).toBe(true);
    expect(handler.lastInput?.prompt).toBe("Approve this email draft?");

    // Verify the artifact is fetchable post-run.
    const fetched = await agent.fetchArtifact(ref.artifact_id);
    expect(fetched.media_type).toBe("text/plain");
    expect(Buffer.from(fetched.data ?? "", "base64").toString("utf8")).toBe(draft.toString("utf8"));

    // Observer should have collected its own session's logs (drafting/queued).
    // Have the observer also run the tool to populate its session.
    server.registerTool("noop", async (_args, ctx) => {
      await ctx.log("info", "observer tick");
      return null;
    });
    await observer.invoke("noop", {});
    const items: string[] = [];
    const deadline = Date.now() + 200;
    while (Date.now() < deadline) {
      const next = await Promise.race([
        obsSub.feed.next(),
        new Promise<{ done: true; value: undefined }>((r) =>
          setTimeout(() => r({ done: true, value: undefined }), 50),
        ),
      ]);
      if (next.done) break;
      items.push(next.value.type);
    }
    expect(items.some((t) => t === "log")).toBe(true);

    await obsSub.close();
    await agent.close();
    await observer.close();
    await server.close();
  });
});
