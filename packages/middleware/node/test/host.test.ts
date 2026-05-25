import { describe, expect, it } from "vitest";

import { parseHostHeader } from "../src/host.js";

describe("parseHostHeader", () => {
  // v1.1 Host-header parsing must keep IPv6 literals intact when stripping the
  // port; the previous `raw.split(":", 1)[0]` mangled `[::1]:443` to `"["`.
  const cases: readonly (readonly [string, string])[] = [
    ["", ""],
    ["example.com", "example.com"],
    ["example.com:80", "example.com"],
    ["127.0.0.1", "127.0.0.1"],
    ["127.0.0.1:9000", "127.0.0.1"],
    ["[::1]", "[::1]"],
    ["[::1]:443", "[::1]"],
    ["[2001:db8::1]:8080", "[2001:db8::1]"],
    // No-port forms with embedded brackets are returned unchanged.
    ["[fe80::1%lo0]", "[fe80::1%lo0]"],
  ];

  for (const [raw, host] of cases) {
    it(`${JSON.stringify(raw)} → ${JSON.stringify(host)}`, () => {
      expect(parseHostHeader(raw)).toBe(host);
    });
  }
});
