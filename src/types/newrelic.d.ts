/**
 * Declaracao minima do agente New Relic.
 *
 * O pacote `newrelic` nao publica tipos e o `@types/newrelic` esta ~5 majors
 * atras do agente (v9 vs v14). Aqui fica so a superficie que este repo usa;
 * amplie conforme precisar de mais da API.
 */
declare module "newrelic" {
  /**
   * Executa `handle` dentro de uma background transaction (`OtherTransaction`).
   * Quando `handle` retorna Promise, a transacao fecha ao resolver/rejeitar.
   * O nome final vira `OtherTransaction/<group>/<name>`.
   */
  export function startBackgroundTransaction<T>(name: string, handle: () => T): T;
  export function startBackgroundTransaction<T>(
    name: string,
    group: string,
    handle: () => T
  ): T;

  /** Reporta um erro tratado, opcionalmente com atributos customizados. */
  export function noticeError(
    error: Error,
    customAttributes?: Record<string, string | number | boolean>
  ): void;
}
