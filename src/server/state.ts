import { generateId } from "../shared/id.js";
import { logger } from "../shared/logger.js";
import type {
  Agent,
  AgentRole,
  Message,
  ServerState,
  Subscription,
  Topic,
} from "../shared/types.js";
import { ConflictError, NotFoundError, ValidationError } from "./errors.js";
import { assertValidMetadataSize, assertValidTopicName } from "./validation.js";

export interface RegisterAgentInput {
  agentId?: string;
  role: AgentRole;
  displayName?: string;
}

export interface SubscribeInput {
  agentId: string;
  topic: string;
}

export interface PublishInput {
  topic: string;
  sender: {
    agentId: string;
    role: AgentRole;
    displayName?: string;
  };
  text?: string;
  artifacts?: Message["artifacts"];
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  messageId: string;
  recipients: number;
}

type Waiter = (message: Message) => void;

/**
 * Owns all runtime state for a single aboard-server process. Everything
 * here is in-memory only -- there is no persistence layer, by design.
 */
export class AboardState {
  private readonly agents = new Map<string, Agent>();
  private readonly topics = new Map<string, Topic>();
  private readonly subscriptions = new Map<string, Subscription>();
  private coordinatorId: string | null = null;
  private readonly waiters = new Map<string, Set<Waiter>>();

  // ---- Agents -----------------------------------------------------------

  registerAgent(input: RegisterAgentInput): Agent {
    const agentId = input.agentId ?? generateId();
    const existing = this.agents.get(agentId);
    const agent: Agent = {
      agentId,
      role: input.role,
      displayName: input.displayName,
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    };
    this.agents.set(agentId, agent);
    logger.info("agent.registered", { agentId, role: agent.role });
    return agent;
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new NotFoundError(`Agent not found: ${agentId}`);
    }

    for (const sub of [...this.subscriptions.values()]) {
      if (sub.agentId === agentId) {
        this.unsubscribe(sub.id);
      }
    }

    if (this.coordinatorId === agentId) {
      this.coordinatorId = null;
      logger.info("coordinator.released", { agentId, reason: "unregistered" });
    }

    this.agents.delete(agentId);
    logger.info("agent.unregistered", { agentId });
  }

  getAgent(agentId: string): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new NotFoundError(`Agent not found: ${agentId}`);
    }
    return agent;
  }

  listAgents(): Agent[] {
    return [...this.agents.values()];
  }

  // ---- Coordinator --------------------------------------------------------

  getCoordinator(): string | null {
    return this.coordinatorId;
  }

  claimCoordinator(agentId: string): Agent {
    const agent = this.getAgent(agentId);

    if (this.coordinatorId && this.coordinatorId !== agentId) {
      throw new ConflictError(`Coordinator already claimed by agent: ${this.coordinatorId}`);
    }

    this.coordinatorId = agentId;
    const promoted: Agent = { ...agent, role: "coordinator" };
    this.agents.set(agentId, promoted);
    logger.info("coordinator.claimed", { agentId });
    return promoted;
  }

  releaseCoordinator(agentId: string): void {
    if (this.coordinatorId !== agentId) {
      throw new ConflictError(`Agent ${agentId} is not the current coordinator.`);
    }
    this.coordinatorId = null;
    logger.info("coordinator.released", { agentId, reason: "explicit" });
  }

  // ---- Topics -------------------------------------------------------------

  private ensureTopic(name: string): Topic {
    let topic = this.topics.get(name);
    if (!topic) {
      topic = { name, createdAt: new Date().toISOString() };
      this.topics.set(name, topic);
      logger.info("topic.created", { topic: name });
    }
    return topic;
  }

  listTopics(): Topic[] {
    return [...this.topics.values()];
  }

  getTopic(name: string): Topic {
    const topic = this.topics.get(name);
    if (!topic) {
      throw new NotFoundError(`Topic not found: ${name}`);
    }
    return topic;
  }

  topicExists(name: string): boolean {
    return this.topics.has(name);
  }

  // ---- Subscriptions --------------------------------------------------------

  subscribe(input: SubscribeInput): Subscription {
    assertValidTopicName(input.topic);
    this.getAgent(input.agentId); // throws NotFoundError if missing

    if (input.topic !== "*") {
      this.ensureTopic(input.topic);
    }

    const subscription: Subscription = {
      id: generateId(),
      agentId: input.agentId,
      topic: input.topic,
      createdAt: new Date().toISOString(),
    };
    this.subscriptions.set(subscription.id, subscription);
    logger.info("subscription.created", {
      subscriptionId: subscription.id,
      agentId: subscription.agentId,
      topic: subscription.topic,
    });
    return subscription;
  }

  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new NotFoundError(`Subscription not found: ${subscriptionId}`);
    }
    this.subscriptions.delete(subscriptionId);
    this.waiters.delete(subscriptionId);
    logger.info("subscription.removed", { subscriptionId });
  }

  listSubscriptions(): Subscription[] {
    return [...this.subscriptions.values()];
  }

  getSubscription(subscriptionId: string): Subscription {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new NotFoundError(`Subscription not found: ${subscriptionId}`);
    }
    return subscription;
  }

  // ---- Messages -------------------------------------------------------------

  publish(input: PublishInput): PublishResult {
    assertValidTopicName(input.topic);
    if (input.topic === "*") {
      throw new ValidationError('Cannot publish to wildcard topic "*".');
    }
    assertValidMetadataSize(input.metadata);

    const message: Message = {
      id: generateId(),
      topic: input.topic,
      sender: input.sender,
      text: input.text,
      artifacts: input.artifacts,
      metadata: input.metadata,
      sentAt: new Date().toISOString(),
    };

    this.ensureTopic(input.topic);

    let recipients = 0;
    for (const subscription of this.subscriptions.values()) {
      const matches = subscription.topic === "*" || subscription.topic === message.topic;
      if (!matches) {
        continue;
      }
      const listeners = this.waiters.get(subscription.id);
      if (!listeners || listeners.size === 0) {
        continue; // Nobody is actively waiting -- message is discarded for this subscriber.
      }
      for (const listener of [...listeners]) {
        listener(message);
        recipients += 1;
      }
      listeners.clear();
    }

    logger.info("message.published", {
      messageId: message.id,
      topic: message.topic,
      senderAgentId: message.sender.agentId,
      recipients,
    });

    return { messageId: message.id, recipients };
  }

  /**
   * Registers a one-shot waiter for the given subscription. The returned
   * function must be called to deregister the waiter (e.g. on timeout or
   * client disconnect) if it never fires.
   */
  addWaiter(subscriptionId: string, onMessage: Waiter): () => void {
    this.getSubscription(subscriptionId); // throws NotFoundError if missing
    let set = this.waiters.get(subscriptionId);
    if (!set) {
      set = new Set();
      this.waiters.set(subscriptionId, set);
    }
    set.add(onMessage);
    return () => {
      set?.delete(onMessage);
    };
  }

  // ---- Snapshot -------------------------------------------------------------

  getStateSnapshot(): ServerState {
    return {
      agents: this.listAgents(),
      topics: this.listTopics(),
      subscriptions: this.listSubscriptions(),
      coordinator: this.coordinatorId,
    };
  }
}
