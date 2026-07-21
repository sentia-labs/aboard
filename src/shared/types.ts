export type AgentRole = "worker" | "coordinator";

export interface Artifact {
  type: "file" | "url";
  ref: string;
}

export interface MessageSender {
  agentId: string;
  role: AgentRole;
  displayName?: string;
}

export interface Message {
  id: string;
  topic: string;
  sender: MessageSender;
  text?: string;
  artifacts?: Artifact[];
  metadata?: Record<string, unknown>;
  sentAt: string;
}

export interface Agent {
  agentId: string;
  role: AgentRole;
  displayName?: string;
  registeredAt: string;
}

export interface Topic {
  name: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  agentId: string;
  topic: string; // "*" for wildcard
  createdAt: string;
}

export interface ServerState {
  agents: Agent[];
  topics: Topic[];
  subscriptions: Subscription[];
  coordinator: string | null;
}

export interface DiscoveryInfo {
  url: string;
  pid: number;
  startedAt: string;
}
