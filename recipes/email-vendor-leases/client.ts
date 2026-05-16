/* eslint-disable */
// @ts-nocheck
//
// Submits the triage task with a lease that allows the read-only tools
// but deliberately omits send_reply, so Claude's eventual attempt to
// send hits PERMISSION_DENIED and degrades gracefully.

import { ARCPClient, WebSocketTransport } from "@arcp/sdk";

const client = new ARCPClient({
  client: { name: "triage-client", version: "1.0.0" },
  capabilities: { encodings: ["json"] },
  authScheme: "bearer",
  token: "demo-token",
});
await client.connect(
  await WebSocketTransport.connect("ws://127.0.0.1:7900/arcp"),
);

// the lease grants tool.call only for read-only inbox tools. send_reply
// is intentionally absent — when Claude proposes that tool the agent's
// validateLeaseOp throws PermissionDenied and a tool_result error is
// fed back. the model recovers and returns a drafted (not-sent) reply.
const handle = await client.submit({
  agent: "triage",
  input: {},
  lease: {
    "tool.call": ["inbox_list", "inbox_read"],
  },
});

await handle.done;
