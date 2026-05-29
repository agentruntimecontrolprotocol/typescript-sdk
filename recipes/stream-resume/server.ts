/* eslint-disable */
// @ts-nocheck
//
// A long-form writer agent streams a generated article through ARCP's
// chunked-result primitive. The runtime persists every emitted envelope
// in its EventLog under the session's monotonic event_seq, which lets a
// client reconnect after a transport drop and replay the chunks it
// missed (see the companion client.ts for the resume side).
//
// Highlights: §8.4 ctx.streamResult() with `write()` per delta and a
// `finalize()` that emits the terminating job.result with a result_id;
// §13.3 / §6.3 the EventLog + resumeWindowSeconds wiring that makes the
// session resumable; GLM-5 streaming via the OpenAI-compatible z.ai
// endpoint pipes naturally into the chunked stream.

import OpenAI from "openai";
import {
  ARCPServer,
  EventLog,
  StaticBearerVerifier,
  startWebSocketServer,
} from "@agentruntimecontrolprotocol/sdk";

// GLM-5 via z.ai's OpenAI-compatible API. Swap baseURL for BigModel or
// another GLM provider; the OpenAI SDK shape stays the same.
const glm = new OpenAI({
  apiKey: process.env["ZAI_API_KEY"],
  baseURL: "https://api.z.ai/api/paas/v4/",
});

// resume needs a persistent EventLog and a resume window. without these
// the runtime would treat a dropped transport as a closed session.
const server = new ARCPServer({
  runtime: { name: "writer", version: "1.0.0" },
  capabilities: { encodings: ["json"], agents: ["long-form"] },
  bearer: new StaticBearerVerifier(
    new Map([["demo-token", { principal: "demo" }]]),
  ),
  eventLog: new EventLog(),
  resumeWindowSeconds: 60,
});

server.registerAgent("long-form", async (input, ctx) => {
  const stream = ctx.streamResult();
  let buf = "";

  const completion = await glm.chat.completions.create({
    model: "glm-5",
    stream: true,
    messages: [
      { role: "user", content: `Write a 2000-word article on: ${input.topic}` },
    ],
  });

  for await (const chunk of completion) {
    const delta = chunk.choices[0]?.delta?.content;
    if (!delta) continue;
    buf += delta;
    // flush in paragraph-sized batches — one result_chunk envelope per
    // ~200 chars keeps the seq stream readable without flooding the
    // EventLog with single-token events
    if (buf.length >= 200) {
      await stream.write(buf);
      buf = "";
    }
  }
  // finalize emits the terminal job.result carrying result_id and
  // result_size; inline `result` MUST NOT be used in chunked mode
  await stream.finalize(buf, { summary: `Article on ${input.topic}` });
});

await startWebSocketServer({
  host: "127.0.0.1",
  port: 7901,
  onTransport: (t) => server.accept(t),
});
