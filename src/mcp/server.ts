import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AboardClient, AboardHttpError } from "./client.js";

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof AboardHttpError ? `${err.status}: ${err.message}` : (err as Error).message;
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

async function guarded(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

const artifactShape = z.object({
  type: z.enum(["file", "url"]),
  ref: z.string().min(1),
});

export function createMcpServer(client: AboardClient): McpServer {
  const server = new McpServer({ name: "aboard-mcp", version: "1.0.0" });

  server.registerTool(
    "coordination_get_server_status",
    { description: "Get aboard-server health status." },
    async () => guarded(() => client.getHealth()),
  );

  server.registerTool(
    "coordination_register_agent",
    {
      description:
        "Register the current agent (worker or coordinator) with the aboard server. Reuse the native session identifier as agentId when one is available.",
      inputSchema: {
        role: z.enum(["worker", "coordinator"]).describe("The role this agent plays."),
        agentId: z
          .string()
          .min(1)
          .optional()
          .describe("Stable agent identifier, e.g. the Claude Code session id. A UUID is generated if omitted."),
        displayName: z.string().optional().describe("Human readable label for this agent."),
      },
    },
    async (args) => guarded(() => client.registerAgent(args)),
  );

  server.registerTool(
    "coordination_unregister_agent",
    {
      description: "Remove an agent's registration, subscriptions, and coordinator claim (if any).",
      inputSchema: {
        agentId: z.string().min(1),
      },
    },
    async (args) => guarded(async () => { await client.unregisterAgent(args.agentId); return { removed: args.agentId }; }),
  );

  server.registerTool(
    "coordination_get_agent",
    {
      description: "Retrieve one agent by id.",
      inputSchema: {
        agentId: z.string().min(1),
      },
    },
    async (args) => guarded(() => client.getAgent(args.agentId)),
  );

  server.registerTool(
    "coordination_list_agents",
    { description: "List all currently registered agents." },
    async () => guarded(() => client.listAgents()),
  );

  server.registerTool(
    "coordination_claim_coordinator",
    {
      description: "Attempt to become the coordinator. Fails with a conflict if another agent already holds the role.",
      inputSchema: {
        agentId: z.string().min(1),
      },
    },
    async (args) => guarded(() => client.claimCoordinator(args.agentId)),
  );

  server.registerTool(
    "coordination_release_coordinator",
    {
      description: "Release the coordinator role.",
      inputSchema: {
        agentId: z.string().min(1),
      },
    },
    async (args) => guarded(async () => { await client.releaseCoordinator(args.agentId); return { released: args.agentId }; }),
  );

  server.registerTool(
    "coordination_list_topics",
    { description: "List all known topics." },
    async () => guarded(() => client.listTopics()),
  );

  server.registerTool(
    "coordination_subscribe",
    {
      description: 'Create a subscription for an agent to a topic. Use "*" for the coordinator wildcard subscription.',
      inputSchema: {
        agentId: z.string().min(1),
        topic: z.string().min(1),
      },
    },
    async (args) => guarded(() => client.subscribe(args)),
  );

  server.registerTool(
    "coordination_unsubscribe",
    {
      description: "Remove a subscription.",
      inputSchema: {
        subscriptionId: z.string().min(1),
      },
    },
    async (args) => guarded(async () => { await client.unsubscribe(args.subscriptionId); return { removed: args.subscriptionId }; }),
  );

  server.registerTool(
    "coordination_publish",
    {
      description: "Publish one message to a topic. Delivery is fire-and-forget; if nobody is waiting, the message is discarded.",
      inputSchema: {
        topic: z.string().min(1),
        sender: z.object({
          agentId: z.string().min(1),
          role: z.enum(["worker", "coordinator"]),
          displayName: z.string().optional(),
        }),
        text: z.string().optional(),
        artifacts: z.array(artifactShape).optional(),
        metadata: z.record(z.unknown()).optional(),
      },
    },
    async (args) => guarded(() => client.publish(args)),
  );

  server.registerTool(
    "coordination_wait_for_message",
    {
      description:
        "Block until a message arrives on this subscription, the wait times out, or the subscription closes. Returns exactly one message per call.",
      inputSchema: {
        subscriptionId: z.string().min(1),
        timeoutMs: z.number().int().positive().optional().describe("Maximum time to wait, in milliseconds."),
      },
    },
    async (args) => guarded(() => client.waitForMessage(args.subscriptionId, args.timeoutMs)),
  );

  return server;
}
