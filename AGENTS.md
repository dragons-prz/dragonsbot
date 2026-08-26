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
  commands/     # comandos slash (/config, /recrutar, /verificar, /pontos, /ranking, /painel) + registry
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
npm run deploy:commands        # registrar/atualizar comandos slash no Discord
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
  recrutador — áreas futuras somam no mesmo perfil.
- Ao alterar o schema de dados do Firestore, avalie se é necessário um script
  de migração (padrão: `src/migrate-firestore-members.ts`) e documente as
  coleções afetadas no README.
- Não commitar `.env` nem `firebase-service-account.json` (já ignorados via
  `.gitignore`/`.dockerignore` — confirme antes de dar `git add`).
