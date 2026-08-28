import newrelic from "newrelic";

import { logger } from "../utils/logger";
import { DragonsStore } from "./DragonsStore";

/**
 * Envolve um `DragonsStore` para dar visibilidade a camada de dados sem tocar
 * na implementacao do Firestore:
 *
 * - **Segmento New Relic** por chamada (`Datastore/statement/Firestore/<metodo>`),
 *   entao dentro de cada transacao (command/button/job) da pra ver quanto tempo
 *   foi gasto no Firestore e em qual operacao. Alimenta tambem, de forma
 *   parcial, a aba Databases (metricas `Datastore/*`) — um shim de datastore
 *   completo daria mais, mas e bem mais invasivo.
 * - **Metricas custom** (`Custom/Firestore/*`) para dashboard/alerta no NR.
 * - **Log agregado `firestore.usage`** a cada 5min: sinal de volume/latencia por
 *   metodo que NAO depende do New Relic nem do plano do Firebase — foi a
 *   ausencia disso que deixou o incidente de cota invisivel ate estourar.
 *
 * O agente NR desligado (sem `NEW_RELIC_LICENSE_KEY`) torna as chamadas
 * `startSegment`/`recordMetric` no-ops; o `firestore.usage` continua saindo
 * (desliga com `FIRESTORE_USAGE_LOG=false`).
 */

type OpKind = "read" | "write";

/** Prefixos de metodo que mutam o Firestore. O resto conta como leitura. */
const WRITE_PREFIXES = [
  "set",
  "create",
  "update",
  "add",
  "remove",
  "delete",
  "mark",
  "enqueue",
  "complete",
  "fail",
  "cancel",
  "approve",
  "seed",
  "claim", // claimNext* / claimTicket*: query + transacao que marca o job/ticket
  "reset", // resetStale*: query + batch write
  "close", // closeTicket: transacao (o metodo de ciclo de vida `close` e passthrough)
  "release" // releaseTicketSlot: delete
];

function kindOf(method: string): OpKind {
  return WRITE_PREFIXES.some((prefix) => method.startsWith(prefix)) ? "write" : "read";
}

/** Metodos que nao sao operacao de dados: nao instrumenta nem conta. */
function isPassthrough(method: string): boolean {
  return method === "init" || method === "close" || method.startsWith("watch");
}

interface MethodBucket {
  calls: number;
  errors: number;
  totalMs: number;
}

const FLUSH_INTERVAL_MS = 5 * 60_000;

const byMethod = new Map<string, MethodBucket>();
let windowReads = 0;
let windowWrites = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function record(method: string, kind: OpKind, ms: number, errored: boolean): void {
  const bucket = byMethod.get(method) ?? { calls: 0, errors: 0, totalMs: 0 };
  bucket.calls += 1;
  bucket.totalMs += ms;
  if (errored) {
    bucket.errors += 1;
  }
  byMethod.set(method, bucket);

  if (kind === "read") {
    windowReads += 1;
  } else {
    windowWrites += 1;
  }

  newrelic.incrementMetric("Custom/Firestore/all");
  newrelic.incrementMetric(`Custom/Firestore/${kind}`);
  newrelic.recordMetric(`Custom/Firestore/duration/${method}`, ms);
}

function flush(): void {
  if (byMethod.size === 0) {
    return;
  }

  const methods: Record<string, { calls: number; errors: number; avgMs: number }> = {};
  let totalCalls = 0;
  for (const [method, bucket] of byMethod) {
    methods[method] = {
      calls: bucket.calls,
      errors: bucket.errors,
      avgMs: Math.round(bucket.totalMs / bucket.calls)
    };
    totalCalls += bucket.calls;
  }

  logger.info("firestore.usage", {
    windowMin: FLUSH_INTERVAL_MS / 60_000,
    reads: windowReads,
    writes: windowWrites,
    totalCalls,
    byMethod: methods
  });

  byMethod.clear();
  windowReads = 0;
  windowWrites = 0;
}

function ensureFlushTimer(): void {
  if (flushTimer || process.env.FIRESTORE_USAGE_LOG === "false") {
    return;
  }
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  // Nao segurar o processo aberto so por causa deste timer.
  flushTimer.unref?.();
}

function instrumentMethod(
  method: string,
  fn: (...args: unknown[]) => unknown,
  target: DragonsStore
): (...args: unknown[]) => unknown {
  const kind = kindOf(method);

  return (...args: unknown[]) =>
    newrelic.startSegment(`Datastore/statement/Firestore/${method}`, true, () => {
      const startedAt = performance.now();
      const finish = (errored: boolean) => record(method, kind, performance.now() - startedAt, errored);

      let result: unknown;
      try {
        result = fn.apply(target, args);
      } catch (error) {
        finish(true);
        throw error;
      }

      if (result instanceof Promise) {
        return result.then(
          (value) => {
            finish(false);
            return value;
          },
          (error) => {
            finish(true);
            throw error;
          }
        );
      }

      finish(false);
      return result;
    });
}

export function instrumentStore(store: DragonsStore): DragonsStore {
  ensureFlushTimer();

  const wrapped = new Map<string, unknown>();

  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") {
        return value;
      }
      if (isPassthrough(prop)) {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }

      const cached = wrapped.get(prop);
      if (cached) {
        return cached;
      }
      const instrumented = instrumentMethod(
        prop,
        value as (...args: unknown[]) => unknown,
        target
      );
      wrapped.set(prop, instrumented);
      return instrumented;
    }
  });
}
