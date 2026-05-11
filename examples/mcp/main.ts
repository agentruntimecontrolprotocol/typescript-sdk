/**
 * ARCP runtime fronting an MCP server (RFC §20).
 *
 * MCP describes capabilities; ARCP operationalizes them. This bridge
 * translates inbound ARCP `tool.invoke` envelopes into MCP `call_tool`
 * calls against an upstream MCP server, and emits the ARCP job
 * lifecycle back to the calling client.
 *
 *   ARCP client ──tool.invoke──> bridge ──call_tool──> MCP server
 *   ARCP client <─job.{accepted,started,completed,failed}─ bridge
 */
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { BaseEnvelope } from "../../src/index.js";
import {
  ARCPError,
  buildEnvelope,
  FailedPreconditionError,
  InternalError,
  newJobId,
  newMessageId,
  nowTimestamp,
} from "../../src/index.js";

import { upstreamParams } from "./upstream.js";

// Per RFC §20:
//   MCP tool schema -> ARCP capability  (advertised at session.accepted)
//   MCP tool call   -> ARCP job
//   MCP resource    -> ARCP stream of kind: event  (delegated to MCP)

async function advertiseFromMcp(mcp: MCPClient): Promise<string[]> {
  // MCP `tools/list` → namespaced ARCP capability extensions. Each
  // upstream tool surfaces as `arcpx.mcp.tool.<name>.v1` so clients can
  // negotiate which tools they require at session open.
  const listed = await mcp.listTools();
  return listed.tools.map((t) => `arcpx.mcp.tool.${t.name}.v1`);
}

async function callViaMcp(
  mcp: MCPClient,
  args: { tool: string; arguments: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  // Translate ARCP `tool.invoke.payload` into MCP `call_tool`. MCP
  // returns a list of typed content blocks; we flatten to a JSON-
  // serializable dict for the ARCP `tool.result` / `job.completed`
  // payload. MCP errors become canonical ARCP error codes.
  let result: Awaited<ReturnType<MCPClient["callTool"]>>;
  try {
    result = await mcp.callTool({ name: args.tool, arguments: args.arguments });
  } catch (exc) {
    throw new InternalError({ message: String(exc) });
  }

  if (result.isError === true) {
    const text = (result.content as { text?: string }[]).map((c) => c.text ?? "").join("\n");
    // MCP doesn't carry a typed error code; FAILED_PRECONDITION is the
    // right canonical mapping for "tool ran, said no".
    throw new FailedPreconditionError({ message: text || "tool error" });
  }

  return { content: result.content };
}

type SendEnvelope = (env: BaseEnvelope) => Promise<void>;

async function handleInvoke(args: {
  send: SendEnvelope;
  mcp: MCPClient;
  request: BaseEnvelope;
}): Promise<void> {
  // One inbound ARCP `tool.invoke` → MCP call → ARCP job lifecycle.
  const jobId = newJobId();

  await args.send(
    buildEnvelope({
      id: newMessageId(),
      type: "job.accepted",
      timestamp: nowTimestamp(),
      optional: { correlation_id: args.request.id, job_id: jobId },
      payload: { job_id: jobId, state: "accepted" },
    }) as BaseEnvelope,
  );
  await args.send(
    buildEnvelope({
      id: newMessageId(),
      type: "job.started",
      timestamp: nowTimestamp(),
      optional: { job_id: jobId },
      payload: { job_id: jobId },
    }) as BaseEnvelope,
  );

  try {
    const reqPayload = args.request.payload as {
      tool: string;
      arguments?: Record<string, unknown>;
    };
    const result = await callViaMcp(args.mcp, {
      tool: reqPayload.tool,
      arguments: reqPayload.arguments ?? {},
    });
    await args.send(
      buildEnvelope({
        id: newMessageId(),
        type: "job.completed",
        timestamp: nowTimestamp(),
        optional: { job_id: jobId },
        payload: { result },
      }) as BaseEnvelope,
    );
  } catch (exc) {
    if (!(exc instanceof ARCPError)) throw exc;
    await args.send(
      buildEnvelope({
        id: newMessageId(),
        type: "job.failed",
        timestamp: nowTimestamp(),
        optional: { job_id: jobId },
        payload: exc.toPayload(),
      }) as BaseEnvelope,
    );
  }
}

async function runBridge(send: SendEnvelope, inbound: AsyncIterable<BaseEnvelope>): Promise<void> {
  // Wire one MCP session as the upstream for one ARCP runtime.
  const transport = new StdioClientTransport(upstreamParams());
  const mcp = new MCPClient({ name: "arcp-mcp-bridge", version: "0.0.1" }, { capabilities: {} });
  await mcp.connect(transport);
  const extensions = await advertiseFromMcp(mcp);
  // In production this list would feed `Capabilities.extensions` at
  // the runtime's `session.accepted` so clients negotiate exactly the
  // MCP tools they expect to use.
  process.stdout.write(`bridged: ${extensions.join(",")}\n`);

  for await (const envelope of inbound) {
    if (envelope.type === "tool.invoke") {
      await handleInvoke({ send, mcp, request: envelope });
    }
  }
}

async function main(): Promise<void> {
  // Production version: instantiate an `ARCPServer`, point its
  // tool-invoke handler at `handleInvoke`, and let the WebSocket
  // transport carry inbound envelopes from real ARCP clients. We
  // elide the runtime wiring (symmetric with examples in
  // `arcp.runtime`) so this file stays focused on the §20 translation
  // between protocols.
  const send: SendEnvelope = null as unknown as SendEnvelope; // bound to runtime's outbound channel
  const inbound = null as unknown as AsyncIterable<BaseEnvelope>;
  await runBridge(send, inbound);
}

void main();
