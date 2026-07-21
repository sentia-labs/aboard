import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveryInfo } from "./types.js";

const DEFAULT_PORT = 4870;

export function getDefaultPort(): number {
  return DEFAULT_PORT;
}

/**
 * The discovery file only ever contains transient runtime information
 * (current server URL, pid, start time). It is rewritten on every server
 * start and removed on clean shutdown -- it is not application state.
 */
export function getDiscoveryFilePath(): string {
  if (process.env.ABOARD_DISCOVERY_FILE) {
    return process.env.ABOARD_DISCOVERY_FILE;
  }
  return join(tmpdir(), "aboard", "discovery.json");
}

export function writeDiscoveryFile(info: DiscoveryInfo): void {
  const path = getDiscoveryFilePath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(info, null, 2), "utf8");
}

export function readDiscoveryFile(): DiscoveryInfo | undefined {
  const path = getDiscoveryFilePath();
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as DiscoveryInfo;
  } catch {
    return undefined;
  }
}

export function removeDiscoveryFile(): void {
  const path = getDiscoveryFilePath();
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

/**
 * Server discovery priority:
 *  1. Explicit server URL
 *  2. Environment variable (ABOARD_SERVER_URL)
 *  3. Local runtime discovery file
 */
export function resolveServerUrl(explicitUrl?: string): string | undefined {
  if (explicitUrl) {
    return explicitUrl;
  }
  if (process.env.ABOARD_SERVER_URL) {
    return process.env.ABOARD_SERVER_URL;
  }
  const discovery = readDiscoveryFile();
  return discovery?.url;
}
