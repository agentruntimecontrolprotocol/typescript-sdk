/* eslint-disable */
// @ts-nocheck
//
// A triage agent receives an "inbox check" task with a lease that grants
// read-only tools but NOT send_reply. Claude reads each message, emits a
// vendor-extension event per parsed message so dashboards can render
// them specially, and eventually decides one needs a reply. When it
// tries to call send_reply the lease check denies it; Claude observes
// the PERMISSION_DENIED tool_result and degrades to drafting the reply
// for human review.
//
// Highlights: §13.4 lease violation as a *recoverable* tool_result error
// (not session-fatal), §15 / §8.2 x-vendor.* event-kind namespace, and
// a realistic Claude tool-use loop that handles a deny without crashing.

import Anthropic from "@anthropic-ai/sdk";
import {
  ARCPServer,
  PermissionDeniedError,
  StaticBearerVerifier,
  startWebSocketServer,
  validateLeaseOp,
} from "@agentruntimecontrolprotocol/sdk";

const anthropic = new Anthropic();

const TOOLS = [
  {
    name: "inbox_list",
    description: "List recent unread messages.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "inbox_read",
    description: "Read one message by id.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "send_reply",
    description: "Send a reply to a message.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, body: { type: "string" } },
      required: ["id", "body"],
    },
  },
];

const server = new ARCPServer({
  runtime: { name: "email-triage", version: "1.0.0" },
  capabilities: { encodings: ["json"], agents: ["triage"] },
  bearer: new StaticBearerVerifier(
    new Map([["demo-token", { principal: "demo" }]]),
  ),
});

server.registerAgent("triage", async (_input, ctx) => {
  const messages = [
    {
      role: "user",
      content:
        "Triage my inbox. Read each unread message and reply to anything urgent.",
    },
  ];

  // tool-use loop: Claude proposes a tool call, we authorize against the
  // lease, run it (or surface a denial), feed the result back, repeat
  while (true) {
    const turn = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: TOOLS,
      messages,
    });

    if (turn.stop_reason === "end_turn") {
      // Claude has nothing more to do — return its final answer
      const text = turn.content.find((b) => b.type === "text")?.text ?? "";
      return { drafted_reply: text, sent: false };
    }

    // append the assistant turn so the next call has full context
    messages.push({ role: "assistant", content: turn.content });
    const toolResults = [];

    for (const block of turn.content) {
      if (block.type !== "tool_use") continue;

      await ctx.toolCall({
        tool: block.name,
        args: block.input,
        call_id: block.id,
      });

      try {
        // the lease grants tool.call only for the read-only tools; the
        // send_reply pattern is absent so this throws PermissionDenied
        validateLeaseOp({
          lease: ctx.lease,
          capability: "tool.call",
          target: block.name,
        });
      } catch (err) {
        if (err instanceof PermissionDeniedError) {
          // surface the denial on the ARCP stream...
          await ctx.toolResult({ call_id: block.id, error: err.toPayload() });
          // ...and hand it to Claude as the tool result so the model
          // can recover gracefully — lease violations are not fatal
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `denied: ${err.message}`,
            is_error: true,
          });
          continue;
        }
        throw err;
      }

      // run the (now-authorized) tool; for inbox_read also emit the
      // parsed metadata under x-vendor.acme.email.parsed so dashboards
      // that recognise the namespace can render the message specially
      const result = await runTool(block.name, block.input);
      if (block.name === "inbox_read") {
        await ctx.emitEvent("x-vendor.acme.email.parsed", {
          message_id: result.id,
          from: result.from,
          subject: result.subject,
          urgency: result.urgency,
        });
      }
      await ctx.toolResult({ call_id: block.id, result });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }
});

await startWebSocketServer({
  host: "127.0.0.1",
  port: 7900,
  onTransport: (t) => server.accept(t),
});
