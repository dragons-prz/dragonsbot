'use strict'

/**
 * Configuracao do agente APM do New Relic.
 *
 * Tudo vem de variavel de ambiente (`.env` na VPS, ver `.env.example`) — nenhum
 * segredo mora neste arquivo, que e versionado. Sem `NEW_RELIC_LICENSE_KEY` o
 * agente se desliga sozinho (`agent_enabled`), entao `npm run dev`, `npm start`
 * local e o CI rodam sem ruido e sem exigir conta New Relic.
 *
 * O agente e carregado na primeira linha de `src/index.ts` (`import "newrelic"`).
 */
exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || 'dragonsbot'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY || '',
  agent_enabled: Boolean(process.env.NEW_RELIC_LICENSE_KEY),

  logging: {
    level: process.env.NEW_RELIC_LOG_LEVEL || 'info',
    // "stdout" faz o log do agente sair junto do log do container (docker logs).
    filepath: process.env.NEW_RELIC_LOG || 'stdout'
  },

  distributed_tracing: {
    enabled: true
  },

  application_logging: {
    forwarding: {
      // Encaminhar logs da aplicacao para o New Relic conta no teto de ingest
      // (100 GB/mes no plano free) e o bot loga stack traces inteiros em
      // *.worker_failed / auth.login_failed. Desliga com
      // NEW_RELIC_LOG_FORWARDING=false se o ingest apertar.
      enabled: process.env.NEW_RELIC_LOG_FORWARDING !== 'false'
    }
  },

  // Boilerplate padrao do agente: nunca mandar cabecalhos sensiveis como
  // atributo de transacao.
  attributes: {
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
      'request.headers.setCookie*',
      'request.headers.x*',
      'response.headers.cookie',
      'response.headers.authorization',
      'response.headers.proxyAuthorization',
      'response.headers.setCookie*',
      'response.headers.x*'
    ]
  }
}
