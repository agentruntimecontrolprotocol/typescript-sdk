/**
 * Parse the host portion of an HTTP `Host` header, stripping any trailing
 * port while preserving IPv6 literals.
 *
 * `String.prototype.split(":", 1)` does **not** split-once; it runs a global
 * split and returns the first piece, which mangles IPv6 literals like
 * `[::1]:443` into the single character `[`. This helper is bracket-aware:
 * a `:` is treated as the port delimiter only when it appears outside the
 * `[...]` IPv6 literal.
 *
 * @example
 * parseHostHeader("example.com")        // → "example.com"
 * parseHostHeader("example.com:80")     // → "example.com"
 * parseHostHeader("[::1]")              // → "[::1]"
 * parseHostHeader("[::1]:443")          // → "[::1]"
 * parseHostHeader("[2001:db8::1]:8080") // → "[2001:db8::1]"
 * parseHostHeader("127.0.0.1:9000")     // → "127.0.0.1"
 * parseHostHeader("")                   // → ""
 */
export function parseHostHeader(raw: string): string {
  if (raw.length === 0) return "";
  const lastColon = raw.lastIndexOf(":");
  if (lastColon === -1) return raw;
  const lastBracket = raw.lastIndexOf("]");
  // IPv6 literals (`[::1]`, `[::1]:443`): a colon inside the brackets is part
  // of the address, not a port delimiter. Only strip when the last colon is
  // *after* the closing bracket (or there is no bracketed literal at all).
  if (lastBracket !== -1 && lastColon < lastBracket) return raw;
  return raw.slice(0, lastColon);
}
