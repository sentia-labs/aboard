import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../shared/logger.js";
import type { Message } from "../shared/types.js";
import { AboardState } from "./state.js";
import { isAboardError, ValidationError } from "./errors.js";
import {
  claimCoordinatorSchema,
  parseWithSchema,
  publishSchema,
  registerAgentSchema,
  subscribeSchema,
} from "./validation.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = Number(process.env.ABOARD_HEARTBEAT_INTERVAL_MS ?? 20_000);
export const MAX_REQUEST_BYTES = 1_000_000;

export interface CreateAppOptions {
  state?: AboardState;
  heartbeatIntervalMs?: number;
}

export function createApp(options: CreateAppOptions = {}): { app: Hono; state: AboardState } {
  const state = options.state ?? new AboardState();
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const app = new Hono();

  app.use("*", async (c, next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
      return c.json({ error: `Request body exceeds maximum size of ${MAX_REQUEST_BYTES} bytes.` }, 413);
    }
    await next();
  });

  app.onError((err, c) => {
    if (isAboardError(err)) {
      logger.warn("validation.failed", { path: c.req.path, error: err.message, status: err.status });
      return c.json({ error: err.message }, err.status as 400 | 404 | 409);
    }
    logger.error("request.failed", { path: c.req.path, error: (err as Error).message });
    return c.json({ error: "Internal server error" }, 500);
  });

  // ---- Health & runtime state -------------------------------------------

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/state", (c) => {
    return c.json(state.getStateSnapshot());
  });

  // ---- Coordinator ---------------------------------------------------------

  app.get("/coordinator", (c) => {
    return c.json({ coordinator: state.getCoordinator() });
  });

  app.post("/coordinator/claim", async (c) => {
    const body = parseWithSchema(claimCoordinatorSchema, await safeJson(c));
    const agent = state.claimCoordinator(body.agentId);
    return c.json({ coordinator: agent.agentId, agent });
  });

  app.delete("/coordinator/:agentId", (c) => {
    const agentId = c.req.param("agentId");
    state.releaseCoordinator(agentId);
    return c.body(null, 204);
  });

  // ---- Agents ---------------------------------------------------------------

  app.post("/agents/register", async (c) => {
    const body = parseWithSchema(registerAgentSchema, await safeJson(c));
    const agent = state.registerAgent(body);
    return c.json(agent, 201);
  });

  app.delete("/agents/:agentId", (c) => {
    state.unregisterAgent(c.req.param("agentId"));
    return c.body(null, 204);
  });

  app.get("/agents", (c) => {
    return c.json({ agents: state.listAgents() });
  });

  app.get("/agents/:agentId", (c) => {
    return c.json(state.getAgent(c.req.param("agentId")));
  });

  // ---- Topics -----------------------------------------------------------------

  app.get("/topics", (c) => {
    return c.json({ topics: state.listTopics() });
  });

  app.get("/topics/:topic", (c) => {
    return c.json(state.getTopic(c.req.param("topic")));
  });

  // ---- Subscriptions -----------------------------------------------------------

  app.post("/subscriptions", async (c) => {
    const body = parseWithSchema(subscribeSchema, await safeJson(c));
    const subscription = state.subscribe(body);
    return c.json(subscription, 201);
  });

  app.delete("/subscriptions/:subscriptionId", (c) => {
    state.unsubscribe(c.req.param("subscriptionId"));
    return c.body(null, 204);
  });

  app.get("/subscriptions", (c) => {
    return c.json({ subscriptions: state.listSubscriptions() });
  });

  // ---- Messages -----------------------------------------------------------------

  app.post("/messages", async (c) => {
    const body = parseWithSchema(publishSchema, await safeJson(c));
    const result = state.publish(body);
    return c.json(result, 201);
  });

  // ---- Waiting (SSE) -----------------------------------------------------------

  app.get("/subscriptions/:subscriptionId/events", async (c) => {
    const subscriptionId = c.req.param("subscriptionId");
    // Validate up front so a bad id gets a normal 404 instead of a broken stream.
    state.getSubscription(subscriptionId);

    const timeoutParam = c.req.query("timeoutMs");
    const timeoutMs = timeoutParam !== undefined ? Number(timeoutParam) : undefined;
    if (timeoutParam !== undefined && (!Number.isFinite(timeoutMs) || (timeoutMs as number) <= 0)) {
      throw new ValidationError(`Invalid timeoutMs query parameter: ${timeoutParam}`);
    }

    logger.info("sse.connected", { subscriptionId });

    return streamSSE(c, async (stream) => {
      let settled = false;
      let removeWaiter: (() => void) | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        removeWaiter?.();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };

      stream.onAbort(() => {
        settled = true;
        cleanup();
        logger.info("sse.disconnected", { subscriptionId });
      });

      const messagePromise = new Promise<Message>((resolve) => {
        removeWaiter = state.addWaiter(subscriptionId, resolve);
      });

      heartbeatTimer = setInterval(() => {
        if (settled) return;
        stream.writeSSE({ event: "heartbeat", data: JSON.stringify({ ts: new Date().toISOString() }) }).catch(() => {
          // Connection likely closed; onAbort will handle cleanup.
        });
      }, heartbeatIntervalMs);

      const timeoutPromise =
        timeoutMs !== undefined
          ? new Promise<"timeout">((resolve) => {
              timeoutTimer = setTimeout(() => resolve("timeout"), timeoutMs);
            })
          : new Promise<"timeout">(() => {
              /* never resolves: caller waits indefinitely */
            });

      const outcome = await Promise.race([
        messagePromise.then((message): ["message", Message] => ["message", message]),
        timeoutPromise.then((): ["timeout", undefined] => ["timeout", undefined]),
      ]);

      if (settled) {
        return; // client disconnected before we got a result
      }
      settled = true;
      cleanup();

      if (outcome[0] === "message") {
        await stream.writeSSE({ event: "message", data: JSON.stringify(outcome[1]) });
      } else {
        await stream.writeSSE({ event: "timeout", data: "{}" });
      }
      logger.info("sse.disconnected", { subscriptionId, reason: outcome[0] });
    });
  });

  return { app, state };
}

async function safeJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}
