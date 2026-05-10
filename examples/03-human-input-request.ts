/**
 * Tool that requests human input mid-execution.
 *
 * Demonstrates the §12.1 round-trip: tool blocks, runtime emits
 * `human.input.request`, client's HumanInputHandler responds, tool resumes.
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

class StdoutHumanHandler implements HumanInputHandler {
  public async onInputRequest(req: HumanInputRequestPayload): Promise<HumanInputResponsePayload> {
    process.stdout.write(`[human] prompt: ${req.prompt}\n`);
    return {
      value: { branch: "fix/jwt-validation" },
      responded_by: "demo",
      responded_at: new Date().toISOString(),
    };
  }
  public async onChoiceRequest(
    req: HumanChoiceRequestPayload,
  ): Promise<HumanChoiceResponsePayload> {
    return {
      choice_id: req.options[0]?.id ?? "abort",
      responded_by: "demo",
      responded_at: new Date().toISOString(),
    };
  }
}

async function main(): Promise<void> {
  const server = new ARCPServer({
    runtime: { kind: "demo-runtime", version: "0.0.1" },
    capabilities: { streaming: true, human_input: true },
    bearer: new StaticBearerVerifier(new Map([["t", { principal: "demo" }]])),
    logger: silentLogger,
  });

  server.registerTool("propose-branch", async (_args, ctx) => {
    const value = await ctx.requestHumanInput({
      prompt: "What branch should I create for this fix?",
      response_schema: {
        type: "object",
        properties: { branch: { type: "string", minLength: 1 } },
        required: ["branch"],
      },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    return { picked: value };
  });

  const client = new ARCPClient({
    client: { kind: "demo-client", version: "0.0.1" },
    capabilities: { streaming: true, human_input: true },
    authScheme: "bearer",
    token: "t",
    humanInputHandler: new StdoutHumanHandler(),
    logger: silentLogger,
  });

  const [c, s] = pairMemoryTransports();
  server.accept(s);
  await client.connect(c);

  process.stdout.write("Invoking propose-branch...\n");
  const out = await client.invoke("propose-branch", {});
  process.stdout.write(`Tool returned: ${JSON.stringify(out.result.value)}\n`);

  await client.close();
  await server.close();
}

await main();
