import type { Agent, Message, ServerState, Subscription, Topic } from "../shared/types.js";

export class AboardHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AboardHttpError";
    this.status = status;
  }
}

export interface RegisterAgentRequest {
  agentId?: string;
  role: "worker" | "coordinator";
  displayName?: string;
}

export interface SubscribeRequest {
  agentId: string;
  topic: string;
}

export interface PublishRequest {
  topic: string;
  sender: { agentId: string; role: "worker" | "coordinator"; displayName?: string };
  text?: string;
  artifacts?: Message["artifacts"];
  metadata?: Record<string, unknown>;
}

export type WaitForMessageResult = { status: "message"; message: Message } | { status: "timeout" };

export interface AboardClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin HTTP client translating aboard-mcp tool calls into requests against
 * aboard-server. Contains no coordination logic of its own.
 */
export class AboardClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AboardClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const data: unknown = await res.json().catch(() => undefined);

    if (!res.ok) {
      const message =
        data && typeof data === "object" && "error" in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : res.statusText;
      throw new AboardHttpError(res.status, message);
    }

    return data as T;
  }

  getHealth(): Promise<{ status: string; timestamp: string }> {
    return this.request("GET", "/health");
  }

  getState(): Promise<ServerState> {
    return this.request("GET", "/state");
  }

  getCoordinator(): Promise<{ coordinator: string | null }> {
    return this.request("GET", "/coordinator");
  }

  claimCoordinator(agentId: string): Promise<{ coordinator: string; agent: Agent }> {
    return this.request("POST", "/coordinator/claim", { agentId });
  }

  releaseCoordinator(agentId: string): Promise<void> {
    return this.request("DELETE", `/coordinator/${encodeURIComponent(agentId)}`);
  }

  registerAgent(input: RegisterAgentRequest): Promise<Agent> {
    return this.request("POST", "/agents/register", input);
  }

  unregisterAgent(agentId: string): Promise<void> {
    return this.request("DELETE", `/agents/${encodeURIComponent(agentId)}`);
  }

  listAgents(): Promise<{ agents: Agent[] }> {
    return this.request("GET", "/agents");
  }

  getAgent(agentId: string): Promise<Agent> {
    return this.request("GET", `/agents/${encodeURIComponent(agentId)}`);
  }

  listTopics(): Promise<{ topics: Topic[] }> {
    return this.request("GET", "/topics");
  }

  subscribe(input: SubscribeRequest): Promise<Subscription> {
    return this.request("POST", "/subscriptions", input);
  }

  unsubscribe(subscriptionId: string): Promise<void> {
    return this.request("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  listSubscriptions(): Promise<{ subscriptions: Subscription[] }> {
    return this.request("GET", "/subscriptions");
  }

  publish(input: PublishRequest): Promise<{ messageId: string; recipients: number }> {
    return this.request("POST", "/messages", input);
  }

  async waitForMessage(subscriptionId: string, timeoutMs?: number): Promise<WaitForMessageResult> {
    const url = new URL(`${this.baseUrl}/subscriptions/${encodeURIComponent(subscriptionId)}/events`);
    if (timeoutMs !== undefined) {
      url.searchParams.set("timeoutMs", String(timeoutMs));
    }

    const controller = new AbortController();
    // Safety net in case the server fails to close the stream on its own timeout.
    const safetyTimer = timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs + 5_000) : undefined;

    try {
      const res = await this.fetchImpl(url.toString(), {
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new AboardHttpError(res.status, `Failed to open event stream (status ${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let separatorIndex: number;
        while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const parsed = parseSseBlock(block);
          if (!parsed) {
            continue;
          }
          if (parsed.event === "message") {
            return { status: "message", message: JSON.parse(parsed.data) as Message };
          }
          if (parsed.event === "timeout") {
            return { status: "timeout" };
          }
          // heartbeat or unknown event: keep reading
        }
      }

      return { status: "timeout" };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { status: "timeout" };
      }
      throw err;
    } finally {
      if (safetyTimer) {
        clearTimeout(safetyTimer);
      }
    }
  }
}

function parseSseBlock(block: string): { event?: string; data: string } | undefined {
  const lines = block.split("\n");
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (!event && dataLines.length === 0) {
    return undefined;
  }
  return { event, data: dataLines.join("\n") };
}
