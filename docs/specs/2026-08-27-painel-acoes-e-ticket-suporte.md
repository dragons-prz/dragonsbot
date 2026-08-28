# Painel: ações genéricas + ticket de suporte (lado do bot)

Data: 2026-08-27
Status: Em implementação. Spec canônica (com o contrato completo dos dois
lados) em `dragons-platform/docs/specs/2026-08-27-painel-acoes-e-ticket-suporte.md`.

Este arquivo é o recorte do que muda **neste repositório**.

## Ideia

O painel deixa de ter só botões que respondem com embed efêmero. Ele ganha:

1. **Tipo `select`**: um painel pode ser um único dropdown no lugar das
   linhas de botões (`PanelConfig.kind = "buttons" | "select"`).
2. **Ação genérica por item**: cada botão/opção tem uma `PanelActionConfig`
   — `reply` (comportamento atual) ou `run` (dispara uma ação registrada no
   bot por `actionId` + `params`).

A primeira ação `run` é `support-ticket`: cria um tópico privado de
atendimento, marca o suporte e registra o ticket. A lógica mora num módulo
isolado (`src/commands/panel-actions/support-ticket.ts`), não em
`painel.ts`.

## Mudanças

### `src/domain/types.ts`

- `PanelKind`, `PanelReplyAction`, `PanelRunAction`, `PanelActionConfig`.
- `PanelButtonConfig.action: PanelActionConfig` (campos legados `response`
  / `responseImageUrl` / `responseColor` continuam; ausência de `action` no
  doc = `reply` montada a partir deles).
- `PanelSelectOption`, `PanelSelectConfig`; `PanelConfig.kind` +
  `PanelConfig.select`.
- `SupportCategoryConfig`, `SupportCategoryCloseAction`.
- `TicketRecord`, `TicketStatus`.
- `PANEL_ACTION_IDS` (lista dos `actionId` válidos — espelho do
  `PANEL_ACTIONS` da plataforma).

### `src/storage/DragonsStore.ts` + `FirestoreDragonsStore.ts`

Leitura (a plataforma escreve):

- `getSupportCategory(guildId, id)`, `listSupportCategories(guildId)`.

Escrita (o bot é dono):

- `claimTicketSlot(guildId, openerUserId): Promise<boolean>` — `create`
  atômico de `openTicketKeys/{guildId}_{openerUserId}`; `false` se já
  existe.
- `releaseTicketSlot(guildId, openerUserId)`.
- `createTicket(input): Promise<TicketRecord>`.
- `getTicket(ticketId)`.
- `claimTicket(ticketId, claimerUserId)` — transação: só `open` → `claimed`.
- `closeTicket(ticketId, closerUserId)` — transação: `open`/`claimed` →
  `closed`.

`mapPanel` passa a preencher `kind` (default `"buttons"`), `select`
(default `null`) e `action` de cada botão (backfill a partir dos campos
legados quando ausente).

`instrumentedStore`: os prefixos `get`/`list` (leitura) e
`create`/`claim`/`close`/`release` (escrita) já são reconhecidos —
`WRITE_PREFIXES` não muda (`release` **não** é prefixo de escrita
conhecido; adicionar).

### `src/commands/painel.ts`

- `buildPanelMessage`: se `panel.kind === "select"` e `panel.select`,
  monta um `StringSelectMenuBuilder` (`custom_id = panelsel:{panelId}`,
  `placeholder`, uma option por `select.options` com `value = option.id`),
  numa única `ActionRow`. Caso contrário, as linhas de botões de hoje.
- `resolveButtonAction` / util compartilhada: dado um `PanelActionConfig`,
  ou responde o embed efêmero (`reply`) ou chama
  `runPanelAction(actionId, { interaction, store, params })`.
- `panelButtonHandler`: usa a `action` do botão (não mais só `response`).
- `panelSelectHandler` (novo `SelectMenuHandler`, prefixo `panelsel:`):
  resolve a option escolhida e despacha a `action` dela.

### `src/commands/panel-actions/` (novo)

- `registry.ts`: `PanelActionHandler` (`{ interaction, store, params }` →
  `Promise<void>`), `PANEL_ACTION_REGISTRY`, `runPanelAction`.
- `support-ticket.ts`: abre o ticket (deferReply efêmero → `claimTicketSlot`
  → `getSupportCategory` → cria tópico privado → adiciona autor → posta
  ping do suporte + botões → `createTicket` → edita o defer).

### `src/commands/ticket-actions.ts` (novo)

`ticketActionButtonHandler` (`customIdPrefix = "ticketact:"`):

- `ticketact:claim:{ticketId}` — valida cargo de suporte da categoria →
  `claimTicket` → posta `claimMessage`, desabilita o botão "Atender".
- `ticketact:close:{ticketId}` — valida cargo de suporte → `closeTicket` →
  `releaseTicketSlot` → posta `closeMessage` → `members.remove(opener)` +
  `setLocked(true)` + `setArchived(true)` → desabilita os dois botões.

### `src/commands/index.ts` + `src/index.ts`

- `selectMenuHandlers: SelectMenuHandler[]` exportado de `commands/index.ts`.
- `src/index.ts`: novo ramo `interaction.isStringSelectMenu()` que acha o
  handler por `customId.startsWith(prefix)` e o roda dentro de uma
  background transaction (`txName` = prefixo sem `:`), igual ao ramo de
  botão. `ticketActionButtonHandler` entra em `buttonHandlers`.

### Templates

`renderTemplate(str, vars)` simples (troca `{user}`, `{claimer}`,
`{closer}` por menção). Sem lib.

### README

- Seção `/painel`: tipo `select`, ação por item.
- Nova seção "Ticket de suporte" (categorias em `supportCategories`,
  coleções `tickets` / `openTicketKeys`, permissões exigidas do bot).
- Lista de coleções: `supportCategories`, `tickets`, `openTicketKeys`.
- Lista de eventos de log novos: `panel.action_run`, `ticket.opened`,
  `ticket.claimed`, `ticket.closed`, `ticket.slot_taken`,
  `ticket.open_denied`.

## Validação

`npm run build` (TypeScript strict). Sem suíte automatizada; teste manual
depende de credenciais Discord/Firestore reais (não disponíveis em CI).
