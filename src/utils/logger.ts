import newrelic from "newrelic";

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
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  // Encaminha para o New Relic. O agente so auto-instrumenta winston/pino/
  // bunyan; este logger e `console` puro, entao sem isto a aba Logs do APM
  // fica vazia. No-op quando o agente esta desativado (sem NEW_RELIC_LICENSE_KEY)
  // ou com NEW_RELIC_LOG_FORWARDING=false. Dentro de uma transacao o NR ja
  // correlaciona o log com o trace automaticamente. `message` vai como o JSON
  // inteiro — o NR faz parse de mensagem JSON e expoe `event`/`level`/campos
  // como atributos consultaveis.
  newrelic.recordLogEvent({ message: line, level, timestamp: Date.now() });
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
