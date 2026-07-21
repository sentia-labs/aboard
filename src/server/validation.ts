import { z } from "zod";
import { ValidationError } from "./errors.js";

// Topic names are flat, human-readable identifiers. "*" is reserved for
// wildcard subscriptions and is validated separately.
const TOPIC_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.\-/]{0,127}$/;

export const MAX_TEXT_LENGTH = 20_000;
export const MAX_METADATA_BYTES = 20_000;
export const MAX_ARTIFACTS = 50;
export const MAX_DISPLAY_NAME_LENGTH = 200;

export function assertValidTopicName(topic: string): void {
  if (topic === "*") {
    return;
  }
  if (!TOPIC_NAME_PATTERN.test(topic)) {
    throw new ValidationError(
      `Invalid topic name: "${topic}". Topics must be 1-128 characters of letters, numbers, "_", ".", "-", or "/".`,
    );
  }
}

export const artifactSchema = z.object({
  type: z.enum(["file", "url"]),
  ref: z.string().min(1).max(2048),
});

export const registerAgentSchema = z.object({
  agentId: z.string().min(1).max(256).optional(),
  role: z.enum(["worker", "coordinator"]),
  displayName: z.string().max(MAX_DISPLAY_NAME_LENGTH).optional(),
});

export const claimCoordinatorSchema = z.object({
  agentId: z.string().min(1).max(256),
});

export const subscribeSchema = z.object({
  agentId: z.string().min(1).max(256),
  topic: z.string().min(1).max(128),
});

export const publishSchema = z.object({
  topic: z.string().min(1).max(128),
  sender: z.object({
    agentId: z.string().min(1).max(256),
    role: z.enum(["worker", "coordinator"]),
    displayName: z.string().max(MAX_DISPLAY_NAME_LENGTH).optional(),
  }),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  artifacts: z.array(artifactSchema).max(MAX_ARTIFACTS).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export function assertValidMetadataSize(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) {
    return;
  }
  const size = Buffer.byteLength(JSON.stringify(metadata), "utf8");
  if (size > MAX_METADATA_BYTES) {
    throw new ValidationError(
      `metadata payload too large: ${size} bytes exceeds limit of ${MAX_METADATA_BYTES} bytes.`,
    );
  }
}

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data;
}
