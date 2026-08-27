import { logger } from "./logger";

/**
 * Loop generico das filas internas do bot (`panelJobs`, `memberActionJobs`).
 *
 * Antes, cada fila tinha um `setInterval(tick, 5000)` proprio: o worker batia
 * no Firestore de 5 em 5 segundos para sempre, tivesse trabalho ou nao. Com
 * dois workers isso passava de 60 mil leituras/dia so ociando — o suficiente
 * para estourar a cota diaria do plano Spark e derrubar o Firestore inteiro
 * (login do painel included) com `RESOURCE_EXHAUSTED`.
 *
 * Agora o disparo primario e um observador (`watch`, tipicamente um
 * `onSnapshot` da query de jobs `pending`): o worker so acorda quando um job
 * de fato entra na fila. O `setTimeout` recorrente vira apenas rede de
 * seguranca (destrava jobs presos, cobre a janela minuscula entre "fila
 * esvaziou" e o proximo evento, e roda mesmo se o observador cair). Em falha,
 * o proximo agendamento usa backoff exponencial em vez de repetir em 5s.
 */
export interface JobWorkerOptions {
  /** Prefixo dos eventos de log, ex.: `"panel_job"`. */
  name: string;
  /** Reprocessa jobs travados em `processing`; retorna quantos destravou. */
  resetStale: () => Promise<number>;
  /** Pega e processa o proximo job `pending`; retorna `false` quando a fila esvazia. */
  drainOne: () => Promise<boolean>;
  /**
   * Registra o observador da fila. Recebe um callback para chamar sempre que
   * houver (ou passar a haver) job pendente; retorna uma funcao que cancela a
   * observacao.
   */
  watch: (onPending: () => void) => () => void;
  /** Intervalo da rede de seguranca quando tudo esta saudavel. Default 60s. */
  safetyPollMs?: number;
  /** Teto do backoff exponencial apos falhas consecutivas. Default 15min. */
  maxBackoffMs?: number;
}

const DEFAULT_SAFETY_POLL_MS = 60_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000;

export function startJobWorker(options: JobWorkerOptions): () => void {
  const safetyPollMs = options.safetyPollMs ?? DEFAULT_SAFETY_POLL_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let running = false;
  let stopped = false;
  let rerunRequested = false;
  let consecutiveFailures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number): void => {
    if (stopped) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
  };

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    if (running) {
      // Evento chegou no meio de um drain: marca para revarrer ao terminar,
      // em vez de perder o gatilho e depender da rede de seguranca.
      rerunRequested = true;
      return;
    }

    running = true;
    try {
      const resetCount = await options.resetStale();
      if (resetCount > 0) {
        logger.warn(`${options.name}.stale_reset`, { resetCount });
      }

      do {
        rerunRequested = false;
        while (!stopped) {
          const drained = await options.drainOne();
          if (!drained) {
            break;
          }
        }
      } while (rerunRequested && !stopped);

      consecutiveFailures = 0;
      schedule(safetyPollMs);
    } catch (error) {
      consecutiveFailures += 1;
      const backoffMs = Math.min(
        safetyPollMs * 2 ** (consecutiveFailures - 1),
        maxBackoffMs
      );
      logger.error(`${options.name}.worker_failed`, error, {
        consecutiveFailures,
        nextRetryMs: backoffMs
      });
      schedule(backoffMs);
    } finally {
      running = false;
    }
  };

  const unwatch = options.watch(() => {
    void tick();
  });

  void tick();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    unwatch();
  };
}
