/**
 * Relay scenario: tool produces a small artifact AND requests human input
 * during execution. Combines §12 (HITL), §16 (artifacts), and §13 (logs)
 * into one short flow.
 */
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
} from "../src/index.js";

class CliHumanHandler implements HumanInputHandler {
  public async onInputRequest(req: HumanInputRequestPayload): Promise<HumanInputResponsePayload> {
    process.stdout.write(`[human] ${req.prompt}\n`);
    return {
      value: { confirmed: true },
      responded_by: "operator",
      responded_at: new Date().toISOString(),
    };
  }
  public async onChoiceRequest(
    req: HumanChoiceRequestPayload,
  ): Promise<HumanChoiceResponsePayload> {
    return {
      choice_id: req.options[0]?.id ?? "abort",
      responded_by: "operator",
      responded_at: new Date().toISOString(),
    };
  }
}

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { kind: "demo-runtime", version: "0.0.1" },
    capabilities: { streaming: true, human_input: true, artifacts: true },
    bearer: new StaticBearerVerifier(new Map([["t", { principal: "demo" }]])),
    logger: silentLogger,
  });

  server.registerTool("draft-and-confirm", async (_args, ctx) => {
    await ctx.log("info", "generating draft...");
    await ctx.requestHumanInput({
      prompt: "Please confirm the draft is acceptable.",
      response_schema: {
        type: "object",
        properties: { confirmed: { type: "boolean" } },
        required: ["confirmed"],
      },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await ctx.log("info", "publishing artifact");
    return { ok: true };
  });

  const client = new ARCPClient({
    client: { kind: "demo-client", version: "0.0.1" },
    capabilities: { streaming: true, human_input: true, artifacts: true },
    authScheme: "bearer",
    token: "t",
    humanInputHandler: new CliHumanHandler(),
    logger: silentLogger,
  });

  const [c, s] = pairMemoryTransports();
  server.accept(s);
  await client.connect(c);

  // Upload a small artifact for the tool to "work on".
  const draft = Buffer.from(JSON.stringify({ subject: "Q3 review", body: "..." }), "utf8");
  const ref = await client.putArtifact({
    media_type: "application/json",
    data: draft.toString("base64"),
    encoding: "base64",
  });
  process.stdout.write(`Artifact stored: ${ref.artifact_id}\n`);

  const out = await client.invoke("draft-and-confirm", { artifact_id: ref.artifact_id });
  process.stdout.write(`Tool returned: ${JSON.stringify(out.result.value)}\n`);

  await client.releaseArtifact(ref.artifact_id);
  await client.close();
  await server.close();
}

await main();
