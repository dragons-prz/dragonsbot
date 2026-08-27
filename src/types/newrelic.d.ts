/**
 * Declaracao minima do agente New Relic.
 *
 * O pacote `newrelic` nao publica tipos e o `@types/newrelic` esta ~5 majors
 * atras do agente (v9 vs v14). Aqui fica so a superficie que este repo usa;
 * amplie conforme precisar de mais da API.
 *
 * IMPORTANTE: `module.exports` do `newrelic` e uma INSTANCIA da classe `API`, e
 * os metodos usam `this` (`this.agent`). Por isso a declaracao e `export =` e o
 * consumo tem que ser `import newrelic from "newrelic"` + `newrelic.metodo(...)`
 * — um `import { metodo }` desestrutura a funcao e a chama com `this`
 * undefined, quebrando com "Cannot read properties of undefined (reading
 * 'agent')".
 */
declare module "newrelic" {
  interface NewRelicApi {
    /**
     * Executa `handle` dentro de uma background transaction (`OtherTransaction`).
     * Quando `handle` retorna Promise, a transacao fecha ao resolver/rejeitar.
     * O nome final vira `OtherTransaction/<group>/<name>`.
     */
    startBackgroundTransaction<T>(name: string, handle: () => T): T;
    startBackgroundTransaction<T>(name: string, group: string, handle: () => T): T;

    /**
     * Executa `handler` dentro de um segmento nomeado da transacao atual. Fora
     * de uma transacao, apenas roda o handler. Promise -> segmento fecha no
     * settle.
     */
    startSegment<T>(name: string, record: boolean, handler: () => T, callback?: () => void): T;

    /** Registra um valor numa metrica custom (NR agrega count/total/min/max). */
    recordMetric(name: string, value: number): void;

    /** Incrementa o contador de uma metrica custom (default +1). */
    incrementMetric(name: string, amount?: number): void;

    /** Reporta um erro tratado, opcionalmente com atributos customizados. */
    noticeError(
      error: Error,
      customAttributes?: Record<string, string | number | boolean>
    ): void;

    /**
     * Encaminha uma linha de log para o New Relic. Respeita
     * `application_logging.forwarding.enabled`; no-op com o agente desativado.
     * Dentro de uma transacao, ganha `trace.id`/`span.id` automaticamente.
     */
    recordLogEvent(logEvent: {
      message: string;
      level?: string;
      timestamp?: number;
      [key: string]: unknown;
    }): void;
  }

  const newrelic: NewRelicApi;
  export = newrelic;
}
