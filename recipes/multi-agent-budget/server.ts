/* eslint-disable */
// @ts-nocheck
//
// A research planner with a USD:0.50 budget decomposes a question and
// delegates sub-questions to worker children. Each grant is sliced from
// the planner's own remaining budget, so the cap effectively cascades
// across the tree. Workers that overspend trip BUDGET_EXHAUSTED; the
// planner skips sub-questions that no longer fit.
//
// Highlights: §13.2 delegation + lease-subset enforcement at delegate
// time, §9.6 cost.budget auto-decrement on `cost.*` metrics, and the
// "debit-self-for-each-grant" pattern that turns ARCP's independent
// per-job counters into a shared cascade.

import OpenAI from "openai";
import {
  ARCPServer,
  StaticBearerVerifier,
  startWebSocketServer,
  validateLeaseOp,
} from "@arcp/sdk";

const openai = new OpenAI();
const PHASES = ["gather", "analyze", "summarize"];
const GRANT_BY_DEPTH = { 1: 0.05, 2: 0.1, 3: 0.15 };

const server = new ARCPServer({
  runtime: { name: "research", version: "1.0.0" },
  capabilities: { encodings: ["json"], agents: ["planner", "worker"] },
  bearer: new StaticBearerVerifier(
    new Map([["demo-token", { principal: "demo" }]]),
  ),
});

server.registerAgent("planner", async (input, ctx) => {
  // decompose the question into sub-questions tagged with a depth score
  const plan = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `Decompose into 5 sub-questions. JSON {subQuestions:[{question,depth:1|2|3}]}. Q: ${input.question}`,
      },
    ],
  });
  // charge the plan call against our own budget so the next subset
  // check (below, at each delegate) sees an honest "remaining"
  await ctx.metric({
    name: "cost.completion",
    value: 5.00,
    unit: "USD",
  });
  const { subQuestions } = JSON.parse(plan.choices[0].message.content);

  for (const [i, sq] of subQuestions.entries()) {
    const grant = GRANT_BY_DEPTH[sq.depth];
    // skip if our remaining budget no longer fits this grant — the
    // runtime would reject it anyway via assertLeaseSubset, but a
    // graceful pre-check gives the planner a chance to report it back
    if ((ctx.budget.get("USD") ?? 0) < grant) continue;

    await ctx.delegate({
      delegate_id: `del_${i}`,
      agent: "worker",
      input: sq,
      lease_request: {
        "cost.budget": [`USD:${grant.toFixed(2)}`],
        "tool.call": ["llm.complete"],
      },
    });
    // debit ourselves so the next iteration's pre-check (and the
    // runtime's subset check) reflect what we've already committed
    await ctx.metric({ name: "cost.delegate", value: grant, unit: "USD" });
  }
});

server.registerAgent("worker", async (input, ctx) => {
  // three phases against the worker's own per-job budget
  for (const phase of PHASES) {
    // validateLeaseOp throws BUDGET_EXHAUSTED once the counter ≤ 0;
    // the runtime converts the throw into a terminal job.error
    validateLeaseOp({
      lease: ctx.lease,
      capability: "tool.call",
      target: "llm.complete",
      ctx: { budgetRemaining: ctx.budget },
    });
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: `${phase}: ${input.question}` }],
    });
    await ctx.metric({
      name: "cost.completion",
      value: 5.00,
      unit: "USD",
    });
  }
});

await startWebSocketServer({
  host: "127.0.0.1",
  port: 7899,
  onTransport: (t) => server.accept(t),
});
