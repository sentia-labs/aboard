import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AboardClient } from "../../src/mcp/client.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { startServer, type RunningServer } from "../../src/server/index.js";

let running: RunningServer;
let mcpServer: McpServer;
let client: Client;

beforeEach(async () => {
  running = await startServer({ port: 0, heartbeatIntervalMs: 60_000, writeDiscovery: false });
  const aboardClient = new AboardClient({ baseUrl: running.url });
  mcpServer = createMcpServer(aboardClient);

  client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await mcpServer.close();
  await running.stop();
});

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0]?.text ?? "";
  return { isError: Boolean(result.isError), text, data: result.isError ? undefined : JSON.parse(text) };
}

describe("MCP tool set end-to-end", () => {
  it("reports server status", async () => {
    const { data } = await callTool("coordination_get_server_status");
    expect(data.status).toBe("ok");
  });

  it("registers, retrieves, lists, and unregisters an agent", async () => {
    const registered = await callTool("coordination_register_agent", { role: "worker", displayName: "Worker A" });
    expect(registered.data.agentId).toBeTruthy();
    const agentId = registered.data.agentId;

    const fetched = await callTool("coordination_get_agent", { agentId });
    expect(fetched.data.displayName).toBe("Worker A");

    const listed = await callTool("coordination_list_agents");
    expect(listed.data.agents).toHaveLength(1);

    const removed = await callTool("coordination_unregister_agent", { agentId });
    expect(removed.data.removed).toBe(agentId);

    const afterRemoval = await callTool("coordination_get_agent", { agentId });
    expect(afterRemoval.isError).toBe(true);
  });

  it("claims and releases the coordinator role, surfacing conflicts", async () => {
    const first = await callTool("coordination_register_agent", { role: "coordinator" });
    const second = await callTool("coordination_register_agent", { role: "coordinator" });

    const claim = await callTool("coordination_claim_coordinator", { agentId: first.data.agentId });
    expect(claim.data.coordinator).toBe(first.data.agentId);

    const conflict = await callTool("coordination_claim_coordinator", { agentId: second.data.agentId });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toContain("409");

    const released = await callTool("coordination_release_coordinator", { agentId: first.data.agentId });
    expect(released.data.released).toBe(first.data.agentId);

    const claimAfterRelease = await callTool("coordination_claim_coordinator", { agentId: second.data.agentId });
    expect(claimAfterRelease.isError).toBe(false);
  });

  it("subscribes, publishes, lists topics, and unsubscribes", async () => {
    const worker = await callTool("coordination_register_agent", { role: "worker" });
    const sub = await callTool("coordination_subscribe", { agentId: worker.data.agentId, topic: "billing" });
    expect(sub.data.topic).toBe("billing");

    const published = await callTool("coordination_publish", {
      topic: "billing",
      sender: { agentId: worker.data.agentId, role: "worker" },
      text: "hello",
    });
    expect(published.data.messageId).toBeTruthy();

    const topics = await callTool("coordination_list_topics");
    expect(topics.data.topics.map((t: { name: string }) => t.name)).toContain("billing");

    const unsub = await callTool("coordination_unsubscribe", { subscriptionId: sub.data.id });
    expect(unsub.data.removed).toBe(sub.data.id);
  });

  it("waits for a message end-to-end across two agents", async () => {
    const coordinator = await callTool("coordination_register_agent", { role: "coordinator" });
    const worker = await callTool("coordination_register_agent", { role: "worker" });
    const sub = await callTool("coordination_subscribe", { agentId: coordinator.data.agentId, topic: "*" });

    const waitPromise = callTool("coordination_wait_for_message", {
      subscriptionId: sub.data.id,
      timeoutMs: 5000,
    });

    // Give the wait call a moment to open its SSE connection before publishing.
    await new Promise((resolve) => setTimeout(resolve, 100));

    await callTool("coordination_publish", {
      topic: "release-2026",
      sender: { agentId: worker.data.agentId, role: "worker" },
      text: "worker onboarded",
    });

    const result = await waitPromise;
    expect(result.data.status).toBe("message");
    expect(result.data.message.topic).toBe("release-2026");
    expect(result.data.message.text).toBe("worker onboarded");
  });

  it("times out coordination_wait_for_message when no message arrives", async () => {
    const worker = await callTool("coordination_register_agent", { role: "worker" });
    const sub = await callTool("coordination_subscribe", { agentId: worker.data.agentId, topic: "billing" });

    const result = await callTool("coordination_wait_for_message", { subscriptionId: sub.data.id, timeoutMs: 200 });
    expect(result.data.status).toBe("timeout");
  });

  it("surfaces validation errors as tool errors rather than throwing", async () => {
    const result = await callTool("coordination_register_agent", { role: "manager" });
    expect(result.isError).toBe(true);
  });
});
