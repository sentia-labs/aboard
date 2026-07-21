import { serve, type ServerType } from "@hono/node-server";
import { logger } from "../shared/logger.js";
import { getDefaultPort, removeDiscoveryFile, writeDiscoveryFile } from "../shared/discovery.js";
import { createApp } from "./app.js";
import type { AboardState } from "./state.js";

export interface StartServerOptions {
  port?: number;
  hostname?: string;
  heartbeatIntervalMs?: number;
  writeDiscovery?: boolean;
}

export interface RunningServer {
  server: ServerType;
  state: AboardState;
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? getDefaultPort();
  const writeDiscovery = options.writeDiscovery ?? true;
  const { app, state } = createApp({ heartbeatIntervalMs: options.heartbeatIntervalMs });

  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, port: requestedPort, hostname }, () => resolve(s));
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://${hostname}:${port}`;

  if (writeDiscovery) {
    writeDiscoveryFile({ url, pid: process.pid, startedAt: new Date().toISOString() });
  }
  logger.info("server.started", { url, pid: process.pid });

  const stop = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    if (writeDiscovery) {
      removeDiscoveryFile();
    }
    logger.info("server.stopped", { url });
  };

  return { server, state, port, url, stop };
}
