/* eslint-disable */
// @ts-nocheck
//
// An MCP server that bridges to the multi-agent-budget runtime, exposing
// the ARCP planner as a single `research` tool. The Claude Code skill in
// skills/research/SKILL.md describes when to invoke the tool; this file
// is the runtime bridge it ends up calling.
//
// Highlights: the seam between MCP (model-side tool surface) and ARCP
// (runtime-side agent execution). One long-lived ARCP session per MCP
// process; each MCP tool call submits a fresh ARCP job through it. The
// agent's eventual lease, cost cap, and delegation tree are entirely
// ARCP concerns — MCP just sees one call in, one result out.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

// one ARCP session for the lifetime of the bridge process. each MCP
// tool call submits a new job through this session.
const arcp = new ARCPClient({
  client: { name: "mcp-bridge", version: "1.0.0" },
  capabilities: { encodings: ["json"] },
  authScheme: "bearer",
  token: "demo-token",
});
await arcp.connect(
  await WebSocketTransport.connect("ws://127.0.0.1:7899/arcp"),
);

const mcp = new Server(
  { name: "arcp-research-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// advertise one tool. the MCP host (Claude Code / Cursor / Desktop)
// reads this schema and presents it to the model as a callable tool.
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "research",
      description:
        "Decompose a research question into sub-questions and answer each under a shared cost cap. Returns the plan, delegated sub-questions, and any dropped for budget.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string" },
          budget_usd: { type: "number", default: 0.5 },
        },
        required: ["question"],
      },
    },
  ],
}));

// tool invocation: forward into ARCP and shape the terminal result
// back as an MCP tool response.
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "research") {
    throw new Error(`unknown tool: ${req.params.name}`);
  }
  const { question, budget_usd = 0.5 } = req.params.arguments;

  const handle = await arcp.submit({
    agent: "planner",
    input: { question },
    lease: {
      "cost.budget": [`USD:${budget_usd.toFixed(2)}`],
      "tool.call": ["llm.complete"],
      "agent.delegate": ["worker"],
    },
  });
  const { result } = await handle.done;

  // MCP tool responses are an array of content blocks; here we emit a
  // single text block carrying the planner's JSON result.
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

// MCP servers typically speak stdio to their host process.
await mcp.connect(new StdioServerTransport());
