export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(event: string, fields?: LogFields): void {
    write("info", event, fields);
  },
  warn(event: string, fields?: LogFields): void {
    write("warn", event, fields);
  },
  error(event: string, fields?: LogFields): void {
    write("error", event, fields);
  },
};
