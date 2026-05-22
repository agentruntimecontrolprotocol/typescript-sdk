/* eslint-disable */
// @ts-nocheck
//
// Submits the top-level research question with a USD:0.50 cap. The
// runtime stamps every event in the delegation tree with a strictly
// monotonic event_seq so parent + child streams interleave in one
// session; the client doesn't have to demultiplex.

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const client = new ARCPClient({
  client: { name: "research-client", version: "1.0.0" },
  capabilities: { encodings: ["json"] },
  authScheme: "bearer",
  token: "demo-token",
});
await client.connect(
  await WebSocketTransport.connect("ws://127.0.0.1:7899/arcp"),
);

// workers each carve a slice from the planner's remaining budget. when
// the budget no longer fits a grant the planner drops the sub-question;
// when a worker overspends inside its own slice that worker job ends
// with BUDGET_EXHAUSTED while siblings continue.
const handle = await client.submit({
  agent: "planner",
  input: { question: "What causes urban heat islands?" },
  lease: {
    "cost.budget": ["USD:0.50"],
    "tool.call": ["llm.complete"],
    "agent.delegate": ["worker"],
  },
});

await handle.done;
