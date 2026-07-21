#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDefaultPort, resolveServerUrl } from "../shared/discovery.js";
import { logger } from "../shared/logger.js";
import { AboardClient } from "../mcp/client.js";
import { createMcpServer } from "../mcp/server.js";

function parseServerUrl(): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--server-url="));
  return arg ? arg.split("=").slice(1).join("=") : undefined;
}

async function main() {
  // The MCP adapter contains no coordination logic and must not require
  // aboard-server to already be running just to start up: Claude Code
  // typically launches aboard-mcp before any skill has had a chance to
  // start the server. Fall back to the default local port so the stdio
  // connection always succeeds; individual tool calls simply fail until
  // aboard-server is actually listening.
  const serverUrl = resolveServerUrl(parseServerUrl()) ?? `http://127.0.0.1:${getDefaultPort()}`;

  const client = new AboardClient({ baseUrl: serverUrl });
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("mcp.connected", { serverUrl });
}

main().catch((err) => {
  logger.error("mcp.fatal", { error: (err as Error).message });
  process.exit(1);
});
