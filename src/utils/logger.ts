type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return error;
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info(event: string, fields?: LogFields): void {
    write("info", event, fields);
  },

  warn(event: string, fields?: LogFields): void {
    write("warn", event, fields);
  },

  error(event: string, error: unknown, fields: LogFields = {}): void {
    write("error", event, {
      ...fields,
      error: serializeError(error)
    });
  }
};
