import { describe, expect, it } from "vitest";
import { makePairedHarness, waitFor } from "../helpers/fixtures.js";

describe("§11 streams", () => {
  it("opens a text stream, writes chunks, closes — consumer sees ordered chunks", async () => {
    const h = makePairedHarness();
    h.server.registerTool("emit-text", async (_args, ctx) => {
      const writer = ctx.openStream({ kind: "text", contentType: "text/plain" });
      for (let i = 0; i < 5; i++) {
        await writer.write({ data: `chunk-${i}` });
      }
      await writer.close();
      return { ok: true };
    });
    await h.connect();

    const out = await h.client.invoke("emit-text", {});
    expect(out.result.value).toEqual({ ok: true });
    // streams are populated asynchronously; ensure they appear.
    await waitFor(() => out.streams.size === 1);
    const stream = [...out.streams.values()][0];
    expect(stream).toBeDefined();
    if (stream === undefined) throw new Error("stream missing");
    const collected: string[] = [];
    for await (const chunk of stream) {
      if (typeof chunk.data === "string") collected.push(chunk.data);
    }
    expect(collected).toEqual(["chunk-0", "chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    await h.close();
  });

  it("thought stream carries role/content/redacted per §11.4", async () => {
    const h = makePairedHarness();
    h.server.registerTool("think", async (_args, ctx) => {
      const writer = ctx.openStream({ kind: "thought" });
      await writer.write({ role: "assistant_thought", content: "Considering...", redacted: false });
      await writer.write({ role: "assistant_thought", content: "", redacted: true });
      await writer.close();
      return null;
    });
    await h.connect();
    const out = await h.client.invoke("think", {});
    await waitFor(() => out.streams.size === 1);
    const stream = [...out.streams.values()][0];
    if (stream === undefined) throw new Error("stream missing");
    const collected: Array<{ role?: string; content?: string; redacted?: boolean }> = [];
    for await (const chunk of stream) {
      const entry: { role?: string; content?: string; redacted?: boolean } = {};
      if (typeof chunk.role === "string") entry.role = chunk.role;
      if (typeof chunk.content === "string") entry.content = chunk.content;
      if (typeof chunk.redacted === "boolean") entry.redacted = chunk.redacted;
      collected.push(entry);
    }
    expect(collected).toEqual([
      { role: "assistant_thought", content: "Considering...", redacted: false },
      { role: "assistant_thought", content: "", redacted: true },
    ]);
    await h.close();
  });

  it("backpressure: applyBackpressure slows subsequent writes", async () => {
    const h = makePairedHarness();
    h.server.registerTool("backp", async (_args, ctx) => {
      const writer = ctx.openStream({ kind: "text" });
      writer.applyBackpressure(50); // 50 chunks/sec → 20ms per write
      const start = Date.now();
      for (let i = 0; i < 5; i++) {
        await writer.write({ data: `${i}` });
      }
      const elapsed = Date.now() - start;
      await writer.close();
      return { elapsed };
    });
    await h.connect();
    const out = await h.client.invoke("backp", {});
    const elapsed = (out.result.value as { elapsed: number }).elapsed;
    expect(elapsed).toBeGreaterThanOrEqual(80); // 4 backpressure delays × 20ms
    await h.close();
  });
});
