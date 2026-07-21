import { describe, expect, it } from "vitest";
import { AboardState } from "../../src/server/state.js";
import { ConflictError, NotFoundError, ValidationError } from "../../src/server/errors.js";

describe("AboardState agents", () => {
  it("registers an agent, generating an id when none is supplied", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "worker" });
    expect(agent.agentId).toBeTruthy();
    expect(agent.role).toBe("worker");
    expect(state.getAgent(agent.agentId)).toEqual(agent);
  });

  it("registers an agent with a caller-supplied id", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ agentId: "session-123", role: "worker", displayName: "Worker A" });
    expect(agent.agentId).toBe("session-123");
    expect(agent.displayName).toBe("Worker A");
  });

  it("throws NotFoundError for an unknown agent", () => {
    const state = new AboardState();
    expect(() => state.getAgent("nope")).toThrow(NotFoundError);
  });

  it("unregisters an agent and removes its subscriptions", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "worker" });
    const sub = state.subscribe({ agentId: agent.agentId, topic: "billing" });
    state.unregisterAgent(agent.agentId);
    expect(() => state.getAgent(agent.agentId)).toThrow(NotFoundError);
    expect(() => state.getSubscription(sub.id)).toThrow(NotFoundError);
  });

  it("releases the coordinator role on unregister", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "coordinator" });
    state.claimCoordinator(agent.agentId);
    state.unregisterAgent(agent.agentId);
    expect(state.getCoordinator()).toBeNull();
  });

  it("throws NotFoundError unregistering an unknown agent", () => {
    const state = new AboardState();
    expect(() => state.unregisterAgent("ghost")).toThrow(NotFoundError);
  });
});

describe("AboardState coordinator ownership", () => {
  it("allows the first agent to claim coordinator", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "worker" });
    const claimed = state.claimCoordinator(agent.agentId);
    expect(claimed.role).toBe("coordinator");
    expect(state.getCoordinator()).toBe(agent.agentId);
  });

  it("is idempotent when the same agent re-claims", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "coordinator" });
    state.claimCoordinator(agent.agentId);
    expect(() => state.claimCoordinator(agent.agentId)).not.toThrow();
    expect(state.getCoordinator()).toBe(agent.agentId);
  });

  it("rejects a second, different coordinator with ConflictError", () => {
    const state = new AboardState();
    const first = state.registerAgent({ role: "coordinator" });
    const second = state.registerAgent({ role: "coordinator" });
    state.claimCoordinator(first.agentId);
    expect(() => state.claimCoordinator(second.agentId)).toThrow(ConflictError);
    expect(state.getCoordinator()).toBe(first.agentId);
  });

  it("releases the coordinator role", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "coordinator" });
    state.claimCoordinator(agent.agentId);
    state.releaseCoordinator(agent.agentId);
    expect(state.getCoordinator()).toBeNull();
  });

  it("rejects release from a non-coordinator agent", () => {
    const state = new AboardState();
    const coordinator = state.registerAgent({ role: "coordinator" });
    const other = state.registerAgent({ role: "worker" });
    state.claimCoordinator(coordinator.agentId);
    expect(() => state.releaseCoordinator(other.agentId)).toThrow(ConflictError);
  });

  it("allows a new claim after release", () => {
    const state = new AboardState();
    const first = state.registerAgent({ role: "coordinator" });
    const second = state.registerAgent({ role: "coordinator" });
    state.claimCoordinator(first.agentId);
    state.releaseCoordinator(first.agentId);
    expect(() => state.claimCoordinator(second.agentId)).not.toThrow();
    expect(state.getCoordinator()).toBe(second.agentId);
  });
});

describe("AboardState topics", () => {
  it("auto-creates a topic on first subscribe", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "worker" });
    expect(state.topicExists("billing")).toBe(false);
    state.subscribe({ agentId: agent.agentId, topic: "billing" });
    expect(state.topicExists("billing")).toBe(true);
    expect(state.listTopics().map((t) => t.name)).toContain("billing");
  });

  it("auto-creates a topic on first publish", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "worker" });
    state.publish({ topic: "release-2026", sender: { agentId: agent.agentId, role: "worker" } });
    expect(state.topicExists("release-2026")).toBe(true);
  });

  it("does not create a topic entry for the wildcard subscription", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "coordinator" });
    state.subscribe({ agentId: agent.agentId, topic: "*" });
    expect(state.topicExists("*")).toBe(false);
  });

  it("rejects invalid topic names", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "worker" });
    expect(() => state.subscribe({ agentId: agent.agentId, topic: "bad topic!" })).toThrow(ValidationError);
  });

  it("throws NotFoundError for an unknown topic lookup", () => {
    const state = new AboardState();
    expect(() => state.getTopic("nope")).toThrow(NotFoundError);
  });
});

describe("AboardState subscriptions", () => {
  it("throws NotFoundError subscribing an unknown agent", () => {
    const state = new AboardState();
    expect(() => state.subscribe({ agentId: "ghost", topic: "billing" })).toThrow(NotFoundError);
  });

  it("removes a subscription", () => {
    const state = new AboardState();
    const agent = state.registerAgent({ role: "worker" });
    const sub = state.subscribe({ agentId: agent.agentId, topic: "billing" });
    state.unsubscribe(sub.id);
    expect(() => state.getSubscription(sub.id)).toThrow(NotFoundError);
  });

  it("throws NotFoundError unsubscribing an unknown id", () => {
    const state = new AboardState();
    expect(() => state.unsubscribe("ghost")).toThrow(NotFoundError);
  });
});

describe("AboardState publish + waiters", () => {
  it("discards a message when nobody is waiting", () => {
    const state = new AboardState();
    const worker = state.registerAgent({ role: "worker" });
    state.subscribe({ agentId: worker.agentId, topic: "billing" });
    const result = state.publish({ topic: "billing", sender: { agentId: worker.agentId, role: "worker" }, text: "hi" });
    expect(result.recipients).toBe(0);
  });

  it("delivers to a topic-specific waiter", () => {
    const state = new AboardState();
    const worker = state.registerAgent({ role: "worker" });
    const sub = state.subscribe({ agentId: worker.agentId, topic: "billing" });

    let delivered: unknown;
    state.addWaiter(sub.id, (message) => {
      delivered = message;
    });

    const result = state.publish({
      topic: "billing",
      sender: { agentId: worker.agentId, role: "worker" },
      text: "status update",
    });

    expect(result.recipients).toBe(1);
    expect(delivered).toMatchObject({ topic: "billing", text: "status update" });
  });

  it("delivers to wildcard waiters regardless of topic", () => {
    const state = new AboardState();
    const coordinator = state.registerAgent({ role: "coordinator" });
    const worker = state.registerAgent({ role: "worker" });
    const wildcardSub = state.subscribe({ agentId: coordinator.agentId, topic: "*" });

    let delivered: unknown;
    state.addWaiter(wildcardSub.id, (message) => {
      delivered = message;
    });

    state.publish({ topic: "frontend-redesign", sender: { agentId: worker.agentId, role: "worker" }, text: "ping" });

    expect(delivered).toMatchObject({ topic: "frontend-redesign", text: "ping" });
  });

  it("delivers one message to each matching waiter but only consumes one wait per waiter", () => {
    const state = new AboardState();
    const worker = state.registerAgent({ role: "worker" });
    const sub = state.subscribe({ agentId: worker.agentId, topic: "billing" });

    let count = 0;
    state.addWaiter(sub.id, () => {
      count += 1;
    });

    state.publish({ topic: "billing", sender: { agentId: worker.agentId, role: "worker" }, text: "one" });
    // Second publish should be discarded: nobody is waiting anymore since
    // the single waiter was consumed by the first message.
    const second = state.publish({ topic: "billing", sender: { agentId: worker.agentId, role: "worker" }, text: "two" });

    expect(count).toBe(1);
    expect(second.recipients).toBe(0);
  });

  it("does not deliver messages to subscriptions on a different topic", () => {
    const state = new AboardState();
    const worker = state.registerAgent({ role: "worker" });
    const sub = state.subscribe({ agentId: worker.agentId, topic: "billing" });

    let called = false;
    state.addWaiter(sub.id, () => {
      called = true;
    });

    state.publish({ topic: "frontend-redesign", sender: { agentId: worker.agentId, role: "worker" }, text: "irrelevant" });
    expect(called).toBe(false);
  });

  it("rejects publishing to the wildcard topic", () => {
    const state = new AboardState();
    const worker = state.registerAgent({ role: "worker" });
    expect(() =>
      state.publish({ topic: "*", sender: { agentId: worker.agentId, role: "worker" } }),
    ).toThrow(ValidationError);
  });

  it("rejects oversized metadata payloads", () => {
    const state = new AboardState();
    const worker = state.registerAgent({ role: "worker" });
    const bigValue = "x".repeat(30_000);
    expect(() =>
      state.publish({
        topic: "billing",
        sender: { agentId: worker.agentId, role: "worker" },
        metadata: { blob: bigValue },
      }),
    ).toThrow(ValidationError);
  });

  it("removing a waiter registration prevents delivery", () => {
    const state = new AboardState();
    const worker = state.registerAgent({ role: "worker" });
    const sub = state.subscribe({ agentId: worker.agentId, topic: "billing" });

    let called = false;
    const remove = state.addWaiter(sub.id, () => {
      called = true;
    });
    remove();

    const result = state.publish({ topic: "billing", sender: { agentId: worker.agentId, role: "worker" }, text: "hi" });
    expect(called).toBe(false);
    expect(result.recipients).toBe(0);
  });
});

describe("AboardState snapshot", () => {
  it("reflects agents, topics, subscriptions, and coordinator", () => {
    const state = new AboardState();
    const coordinator = state.registerAgent({ role: "coordinator" });
    state.claimCoordinator(coordinator.agentId);
    const worker = state.registerAgent({ role: "worker" });
    state.subscribe({ agentId: worker.agentId, topic: "billing" });

    const snapshot = state.getStateSnapshot();
    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.topics.map((t) => t.name)).toEqual(["billing"]);
    expect(snapshot.subscriptions).toHaveLength(1);
    expect(snapshot.coordinator).toBe(coordinator.agentId);
  });
});
