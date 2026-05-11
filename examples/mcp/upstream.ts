/**
 * Upstream MCP server invocation.
 *
 * Real version parameterizes command, args, env via your config layer.
 * Reference servers from the modelcontextprotocol org publish under
 * `@modelcontextprotocol/server-*` (filesystem, git, postgres, slack, ...).
 */
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";

export function upstreamParams(): StdioServerParameters {
  return {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/srv/data"],
  };
}
