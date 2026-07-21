#!/usr/bin/env node
import { logger } from "../shared/logger.js";
import { startServer } from "../server/index.js";

function parsePort(): number | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--port="));
  if (arg) {
    return Number(arg.split("=")[1]);
  }
  if (process.env.ABOARD_PORT) {
    return Number(process.env.ABOARD_PORT);
  }
  return undefined;
}

async function main() {
  const running = await startServer({ port: parsePort() });
  // eslint-disable-next-line no-console
  console.log(`aboard-server listening on ${running.url}`);

  const shutdown = async (signal: string) => {
    logger.info("server.shutdown_signal", { signal });
    await running.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("server.fatal", { error: (err as Error).message });
  process.exit(1);
});
