# AGENTS.md

Instruções para qualquer agente de IA (Claude, Codex, Copilot, Cursor, Gemini, etc.)
trabalhando neste repositório. Este é o único arquivo com instruções completas —
`CLAUDE.md` e equivalentes apenas apontam para cá.

## O que é este projeto

Bot de Discord em TypeScript (`discord.js`) para o servidor Dragons: fluxo de
recrutamento com aprovação por Founder, pontuação e hierarquia automática de
cargos. Persistência em Firebase Firestore atrás da interface `DragonsStore`
(`src/storage/DragonsStore.ts`), hoje implementada por
`src/storage/firestore/FirestoreDragonsStore.ts`.

Leia o `README.md` antes de mexer em regras de negócio — ele documenta o fluxo
completo de recrutamento/aprovação, os comandos slash, as coleções do Firestore
e os eventos de log. Não duplique esse conteúdo aqui; mantenha-o atualizado lá
se o comportamento mudar.

## Estrutura

```
src/
  commands/     # comandos slash (/config, /recrutar, /verificar, /pontos, /pontos-dar, /pontos-resetar, /ranking, /painel, /blacklist) + registry
    recruitment/  # fluxo de recrutamento em 3 etapas: wizard, ficha e montagem das mensagens
    panel-actions/ # acoes `run` de painel: support-ticket, verification-ticket (+ worker de escalonamento)
  config/       # leitura/validação de variáveis de ambiente
  domain/       # tipos de domínio
  storage/      # interface DragonsStore + implementação Firestore
  utils/        # helpers de Discord e logger estruturado
  index.ts              # entrypoint do bot
  deploy-commands.ts    # registra os comandos slash no Discord
  migrate-firestore-members.ts  # script de migração one-off
```

## Comandos

```bash
npm install                    # instalar dependências
npm run dev                    # rodar em desenvolvimento (tsx watch)
npm run build                  # compilar TypeScript -> dist/
npm start                      # rodar build de produção (precisa de npm run build antes)
npm run deploy:commands        # registrar/atualizar comandos slash no Discord (automatico no docker-compose, so precisa rodar a mao fora do Docker)
npm run migrate:firestore-members  # migração one-off de recruiterPoints -> members
```

Não há suíte de testes automatizada neste repo. Validação é `npm run build`
(garante que o TypeScript compila, `strict: true`) seguido do checklist manual
descrito no README (seção "Validação").

Sempre rode `npm run build` antes de reportar uma mudança como concluída.

## Ambiente

- Node.js >= 20 (imagem Docker usa `node:22-alpine`).
- Variáveis de ambiente em `.env` (veja `.env.example`): `DISCORD_CLIENT_ID`,
  `DISCORD_TOKEN`, `DISCORD_GUILD_ID` (opcional, recomendado em dev),
  `FIREBASE_SERVICE_ACCOUNT_PATH`.
- Sem `.env`/credenciais válidas, o bot não conecta ao Discord nem ao
  Firestore — não é possível testar o fluxo fim a fim localmente sem essas
  credenciais. Reporte testes de integração como não executados quando faltar
  isso, em vez de assumir que passariam.
- Observabilidade (ver README "Observabilidade"): o agente APM do New Relic é
  carregado no 1º import de `src/index.ts` e configurado por `newrelic.js` (só
  lê env, sem segredo). Comandos, botões e jobs são envoltos em background
  transactions manuais; `src/storage/instrumentedStore.ts` é um `Proxy` sobre o
  `DragonsStore` que gera segmento/métrica por chamada e o log agregado
  `firestore.usage`. Vars: `NEW_RELIC_LICENSE_KEY` (secret — só no `.env` da
  VPS, nunca no Dockerfile/imagem/git), `NEW_RELIC_APP_NAME`, `NEW_RELIC_LOG`,
  `NEW_RELIC_LOG_LEVEL`, `NEW_RELIC_LOG_FORWARDING`, `FIRESTORE_USAGE_LOG`. Sem
  `NEW_RELIC_LICENSE_KEY` o agente fica desativado (`agent_enabled`), então dev
  e CI rodam sem ele.
- Ao adicionar método novo ao `DragonsStore`: se o nome não começar com um
  prefixo de escrita conhecido (`set`/`create`/`update`/`add`/`remove`/
  `delete`/`mark`/`enqueue`/`complete`/`fail`/`cancel`/`approve`/`seed`/
  `claim`/`reset`), o `instrumentedStore` conta como leitura — ajuste
  `WRITE_PREFIXES` lá se precisar.
- Docker: `Dockerfile` faz build multi-stage; `docker-compose.yml` espera
  `.env` e um `firebase-service-account.json` montado como volume read-only.

## Convenções

- Todo texto voltado ao usuário final (mensagens do bot, respostas de
  comandos slash, embeds) é em português do Brasil. Identificadores de código,
  comentários e commits ficam em inglês ou português técnico consistente com o
  restante do arquivo — siga o que já existe no arquivo que estiver editando.
- Logs são JSON estruturado, um evento por linha, via `src/utils/logger.ts`.
  Ao adicionar um fluxo novo, siga o padrão de nomes de evento existente
  (`dominio.acao` ou `dominio.acao_estado`, ex.: `recruitment.approved`,
  `config.role_set`) e documente o evento novo no README.
- Mudanças em pontuação/hierarquia devem manter a regra de que pontos ficam no
  perfil genérico de membro (`members`), não em uma entidade exclusiva de
  recrutador — áreas futuras somam no mesmo perfil. **Não há up automático de
  cargo de rank**: o bot só aplica o rank base na entrada e calcula o
  `rankName` teórico; subir/descer de rank é manual. `syncMemberRankRoles` foi
  removido — não reintroduza sync de cargo em `/pontos-dar` nem na aprovação.
- O fluxo de `/recrutar` é configurado **só** pela `dragons-platform`
  (`recruitmentConfigs/{guildId}`); não adicione subcomando de `/config` para
  isso. Os tipos `RecruitmentFlowConfig` e companhia em `src/domain/types.ts`
  — incluindo `RecruitmentVerificationTicketConfig` e `RecruitmentRouteConfig` —
  são espelho de `dragons-platform/shared/src/recruitment-config.ts`: mudança de
  forma exige PR coordenado nos dois repositórios.
- Painéis são uma lista de blocos (`PanelBlock[]`, Components V2 — sem
  `layout`/`kind`). `PanelConfig`/`PanelBlock` em `src/domain/types.ts` e a
  migração de leitura `panelBlocksFromLegacy` são espelho de
  `dragons-platform/shared/src/panel.ts` / `panel-migrate.ts` — PR coordenado.
- Entrada de membro: sem card automático — a porta é um painel só de texto
  com botão `verification-ticket`, que abre uma thread (`tickets` com
  `kind: "verification"`). A ficha do `/recrutar` é roteada por
  `familyAreaId` → `familyRoute`/`areaRoute` (canal + cargos que confirmam),
  congelados no `sheetPresentation` junto de `routeKind`.
- O bot congela a configuração no início de cada recrutamento
  (`RecruitmentPresentationSnapshot` no rascunho, `sheetPresentation` no
  recrutamento). Toda montagem de mensagem lê o snapshot, nunca a configuração
  viva — é o que garante que editar o painel valha só para recrutamentos novos
  e que nenhuma mensagem precise ser apagada e reposta.
- Ao alterar o schema de dados do Firestore, avalie se é necessário um script
  de migração (padrão: `src/migrate-firestore-members.ts`) e documente as
  coleções afetadas no README.
- Não commitar `.env` nem `firebase-service-account.json` (já ignorados via
  `.gitignore`/`.dockerignore` — confirme antes de dar `git add`).
