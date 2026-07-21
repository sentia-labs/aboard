import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../../src/server/index.js";

let running: RunningServer;

beforeEach(async () => {
  running = await startServer({ port: 0, heartbeatIntervalMs: 60_000, writeDiscovery: false });
});

afterEach(async () => {
  await running.stop();
});

async function post(path: string, body: unknown) {
  return fetch(`${running.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("health & state", () => {
  it("reports healthy", async () => {
    const res = await fetch(`${running.url}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("starts with empty state", async () => {
    const res = await fetch(`${running.url}/state`);
    const body = await res.json();
    expect(body).toEqual({ agents: [], topics: [], subscriptions: [], coordinator: null });
  });
});

describe("agents", () => {
  it("registers, retrieves, lists, and removes an agent", async () => {
    const registerRes = await post("/agents/register", { role: "worker", displayName: "Worker A" });
    expect(registerRes.status).toBe(201);
    const agent = await registerRes.json();
    expect(agent.agentId).toBeTruthy();

    const getRes = await fetch(`${running.url}/agents/${agent.agentId}`);
    expect(getRes.status).toBe(200);

    const listRes = await fetch(`${running.url}/agents`);
    const list = await listRes.json();
    expect(list.agents).toHaveLength(1);

    const deleteRes = await fetch(`${running.url}/agents/${agent.agentId}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const missingRes = await fetch(`${running.url}/agents/${agent.agentId}`);
    expect(missingRes.status).toBe(404);
  });

  it("rejects an invalid role with 400", async () => {
    const res = await post("/agents/register", { role: "manager" });
    expect(res.status).toBe(400);
  });
});

describe("coordinator", () => {
  it("claims, reports, and releases coordinator", async () => {
    const agent = await (await post("/agents/register", { role: "coordinator" })).json();

    const claimRes = await post("/coordinator/claim", { agentId: agent.agentId });
    expect(claimRes.status).toBe(200);

    const getRes = await fetch(`${running.url}/coordinator`);
    expect((await getRes.json()).coordinator).toBe(agent.agentId);

    const releaseRes = await fetch(`${running.url}/coordinator/${agent.agentId}`, { method: "DELETE" });
    expect(releaseRes.status).toBe(204);

    const getAfterRes = await fetch(`${running.url}/coordinator`);
    expect((await getAfterRes.json()).coordinator).toBeNull();
  });

  it("returns a 409 conflict for a second coordinator", async () => {
    const first = await (await post("/agents/register", { role: "coordinator" })).json();
    const second = await (await post("/agents/register", { role: "coordinator" })).json();

    await post("/coordinator/claim", { agentId: first.agentId });
    const conflictRes = await post("/coordinator/claim", { agentId: second.agentId });
    expect(conflictRes.status).toBe(409);
  });
});

describe("topics", () => {
  it("auto-creates topics via publish and lists them", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    await post("/messages", { topic: "billing", sender: { agentId: worker.agentId, role: "worker" }, text: "hi" });

    const listRes = await fetch(`${running.url}/topics`);
    const list = await listRes.json();
    expect(list.topics.map((t: { name: string }) => t.name)).toContain("billing");

    const getRes = await fetch(`${running.url}/topics/billing`);
    expect(getRes.status).toBe(200);

    const missingRes = await fetch(`${running.url}/topics/does-not-exist`);
    expect(missingRes.status).toBe(404);
  });
});

describe("subscriptions", () => {
  it("creates and removes a subscription", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();

    const subRes = await post("/subscriptions", { agentId: worker.agentId, topic: "billing" });
    expect(subRes.status).toBe(201);
    const sub = await subRes.json();

    const listRes = await fetch(`${running.url}/subscriptions`);
    expect((await listRes.json()).subscriptions).toHaveLength(1);

    const deleteRes = await fetch(`${running.url}/subscriptions/${sub.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const listAfterRes = await fetch(`${running.url}/subscriptions`);
    expect((await listAfterRes.json()).subscriptions).toHaveLength(0);
  });
});

describe("messages", () => {
  it("publishes and returns messageId + recipients", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    const res = await post("/messages", {
      topic: "billing",
      sender: { agentId: worker.agentId, role: "worker" },
      text: "status update",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.messageId).toBeTruthy();
    expect(body.recipients).toBe(0);
  });

  it("rejects publishing to the wildcard topic", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    const res = await post("/messages", { topic: "*", sender: { agentId: worker.agentId, role: "worker" } });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid topic name", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    const res = await post("/messages", {
      topic: "not a valid topic!",
      sender: { agentId: worker.agentId, role: "worker" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized request body with 413", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    const res = await post("/messages", {
      topic: "billing",
      sender: { agentId: worker.agentId, role: "worker" },
      text: "x".repeat(1_100_000),
    });
    expect(res.status).toBe(413);
  });
});

describe("SSE waiting", () => {
  it("returns 404 for an unknown subscription", async () => {
    const res = await fetch(`${running.url}/subscriptions/does-not-exist/events`);
    expect(res.status).toBe(404);
  });

  it("resolves with a message once one is published on the subscribed topic", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    const sub = await (await post("/subscriptions", { agentId: worker.agentId, topic: "billing" })).json();

    const eventsPromise = readSseEvents(`${running.url}/subscriptions/${sub.id}/events`);
    await waitUntilConnected();

    const publishRes = await post("/messages", {
      topic: "billing",
      sender: { agentId: worker.agentId, role: "worker" },
      text: "status update",
    });
    const publishBody = await publishRes.json();
    expect(publishBody.recipients).toBe(1);

    const events = await eventsPromise;
    const messageEvent = events.find((e) => e.event === "message");
    expect(messageEvent).toBeDefined();
    const message = JSON.parse(messageEvent!.data);
    expect(message.topic).toBe("billing");
    expect(message.text).toBe("status update");
  });

  it("delivers to a wildcard coordinator subscription", async () => {
    const coordinator = await (await post("/agents/register", { role: "coordinator" })).json();
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    const sub = await (await post("/subscriptions", { agentId: coordinator.agentId, topic: "*" })).json();

    const eventsPromise = readSseEvents(`${running.url}/subscriptions/${sub.id}/events`);
    await waitUntilConnected();

    await post("/messages", { topic: "release-2026", sender: { agentId: worker.agentId, role: "worker" }, text: "ping" });

    const events = await eventsPromise;
    const messageEvent = events.find((e) => e.event === "message");
    expect(messageEvent).toBeDefined();
    expect(JSON.parse(messageEvent!.data).topic).toBe("release-2026");
  });

  it("times out and closes when no message arrives within timeoutMs", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    const sub = await (await post("/subscriptions", { agentId: worker.agentId, topic: "billing" })).json();

    const events = await readSseEvents(`${running.url}/subscriptions/${sub.id}/events?timeoutMs=200`);
    const timeoutEvent = events.find((e) => e.event === "timeout");
    expect(timeoutEvent).toBeDefined();
  });

  it("discards a message when nobody is actively waiting", async () => {
    const worker = await (await post("/agents/register", { role: "worker" })).json();
    await post("/subscriptions", { agentId: worker.agentId, topic: "billing" });

    const res = await post("/messages", {
      topic: "billing",
      sender: { agentId: worker.agentId, role: "worker" },
      text: "nobody home",
    });
    expect((await res.json()).recipients).toBe(0);
  });

  it("emits heartbeat events while waiting", async () => {
    // Use a dedicated server with a very short heartbeat interval for this test.
    const fast = await startServer({ port: 0, heartbeatIntervalMs: 50, writeDiscovery: false });
    try {
      const worker = await (
        await fetch(`${fast.url}/agents/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "worker" }),
        })
      ).json();
      const sub = await (
        await fetch(`${fast.url}/subscriptions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentId: worker.agentId, topic: "billing" }),
        })
      ).json();

      const events = await readSseEvents(`${fast.url}/subscriptions/${sub.id}/events?timeoutMs=300`);
      const heartbeats = events.filter((e) => e.event === "heartbeat");
      expect(heartbeats.length).toBeGreaterThan(0);
    } finally {
      await fast.stop();
    }
  });
});

describe("discovery file", () => {
  it("is written on start and removed on stop", async () => {
    const discoveryPath = join(tmpdir(), `aboard-test-discovery-${Date.now()}.json`);
    process.env.ABOARD_DISCOVERY_FILE = discoveryPath;
    try {
      const server = await startServer({ port: 0 });
      expect(existsSync(discoveryPath)).toBe(true);
      const info = JSON.parse(readFileSync(discoveryPath, "utf8"));
      expect(info.url).toBe(server.url);

      await server.stop();
      expect(existsSync(discoveryPath)).toBe(false);
    } finally {
      delete process.env.ABOARD_DISCOVERY_FILE;
      rmSync(discoveryPath, { force: true });
    }
  });
});

interface SseEvent {
  event: string;
  data: string;
}

async function readSseEvents(url: string): Promise<SseEvent[]> {
  const res = await fetch(url, { headers: { accept: "text/event-stream" } });
  if (!res.body) {
    throw new Error("No response body");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SseEvent[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = block.split("\n");
      let event = "";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      events.push({ event, data: dataLines.join("\n") });
      if (event === "message" || event === "timeout") {
        return events;
      }
    }
  }
  return events;
}

function waitUntilConnected(): Promise<void> {
  // Give the SSE fetch a tick to reach the server and register its waiter
  // before we publish -- avoids a race where publish fires before connect.
  return new Promise((resolve) => setTimeout(resolve, 50));
}
