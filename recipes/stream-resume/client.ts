/* eslint-disable */
// @ts-nocheck
//
// Demonstrates the disconnect → resume → assemble flow over a chunked
// streaming result. Session 1 connects, submits, and starts receiving
// result_chunk events; the transport is then dropped mid-stream
// (without session.bye, so the session id stays valid for the runtime's
// resume window). Session 2 calls client.resume() with the rotated
// resume_token + the last event_seq we observed, the runtime replays
// every envelope with seq > last_event_seq from its EventLog, and we
// reassemble the article from the union of what both sessions saw.

import { ARCPClient, WebSocketTransport } from "@agentruntimecontrolprotocol/sdk";

const URL = "ws://127.0.0.1:7901/arcp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// one shared buffer so chunks observed in either session land here.
// in a real client you would dedupe by chunk_seq because the resume
// replay may overlap with chunks session 1 already saw.
const chunks = new Map(); // chunk_seq → data
let lastSeq = 0;
let resultId, resultSize;

function onEvent(env) {
  if (env.type !== "job.event" || env.payload.kind !== "result_chunk") return;
  const body = env.payload.body;
  chunks.set(body.chunk_seq, body.data);
  if (env.event_seq !== undefined) lastSeq = env.event_seq;
}

// ── session 1: submit, observe a prefix of chunks, then drop ────────

const c1 = new ARCPClient({
  client: { name: "writer-client", version: "1.0.0" },
  capabilities: { encodings: ["json"] },
  authScheme: "bearer",
  token: "demo-token",
});
const t1 = await WebSocketTransport.connect(URL);
const welcome1 = await c1.connect(t1);
c1.on("job.event", onEvent);

await c1.submit({
  agent: "long-form",
  input: { topic: "urban heat islands" },
});

// let some chunks arrive, then yank the network. closing the transport
// directly (rather than client.close(), which sends session.bye) leaves
// the session id valid for resumeWindowSeconds.
await sleep(800);
await t1.close("simulated network drop");

// ── session 2: resume with the session id + rotated token + lastSeq ─

const c2 = new ARCPClient({
  client: { name: "writer-client", version: "1.0.0" },
  capabilities: { encodings: ["json"] },
  authScheme: "bearer",
  token: "demo-token",
});
const t2 = await WebSocketTransport.connect(URL);
const welcome2 = await c2.resume(t2, {
  session_id: c1.state.id,
  resume_token: welcome1.resume_token, // single-use; runtime rotates a fresh one
  last_event_seq: lastSeq,
});

// resume doesn't bind a fresh handle on c2; observe terminal envelopes
// directly and the runtime will replay everything with seq > lastSeq.
c2.on("job.event", onEvent);
await new Promise((resolve) => {
  c2.on("job.result", (env) => {
    resultId = env.payload.result_id;
    resultSize = env.payload.result_size;
    resolve(undefined);
  });
});

// assemble the article from chunks ordered by chunk_seq. the map dedup
// is what handles the resume boundary — if session 1 saw chunk_seq 3
// and the runtime replays 3 again, the second write just overwrites.
const article = [...chunks.entries()]
  .sort(([a], [b]) => a - b)
  .map(([, data]) => data)
  .join("");
