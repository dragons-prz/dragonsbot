# Verificação e recrutamento por ticket (spec canônica)

Data: 2026-08-30
Status: Planejado. Spec canônica (fluxo completo, tipos, contrato dos dois
lados). O recorte do que muda na plataforma está em
`dragons-platform/docs/specs/2026-08-30-verificacao-recrutamento-por-ticket.md`.

Entrega em **2 PRs coordenados** (mesmo dia): primeiro a plataforma
(`shared/` + editores), depois o bot. Os tipos de `shared/` são espelho de
`src/domain/types.ts` — mudança de forma exige os dois PRs juntos.

---

## 1. Ideia

Hoje a entrada de um membro passa por **três peças desconectadas**:

- `GuildMemberAdd` → card automático no canal `verification` com botão
  **Verificar** (só `founder`, verificação direta, sem ficha e sem pontos);
- `/recrutar` → comando avulso em canal qualquer → wizard de 3 etapas →
  ficha em `sheet.channelId` → `approverRoleIds` confirmam;
- tickets de suporte → ação de painel `support-ticket` → tópico privado.

O novo fluxo é **um pipeline único**, com entrada por um **painel de texto**:

```
Membro entra no servidor
   │
   ▼
[Painel de texto "Verificar-se"]  ── botão ──►  formulário "Veio por alguém?"
   │                                              ├─ escolhe um recrutador da lista
   │                                              └─ ❌ Nenhum
   ▼
Abre THREAD privada (ticket de verificação), visível só para o cargo de Recrutamento
   ├─ recrutador escolhido  → thread menciona ESSE recrutador; ele dá continuidade
   │                          → se em 1h o membro não foi recrutado, o bot marca
   │                            TODO o cargo `recruiter` na thread
   └─ "Nenhum"              → thread menciona o cargo `recruiter`; qualquer um analisa
   │
   ▼
Um recrutador roda  /recrutar @membro  DENTRO da thread  (mesmo wizard de hoje)
   │  etapa 1: cargo de iniciante · etapa 2: área(s) · etapa 3: confirmação
   ▼
Ficha postada — o destino depende da área escolhida na etapa 2:
   ├─ área "Familia" marcada  → canal dos FOUNDERS ("Verificação das Posses")
   │                             → um Founder confirma
   │                             → aplica cargos + credita pontos + anuncia
   │                             → mensagem do wizard some da thread + thread arquiva
   │
   └─ qualquer outra área     → canal do LÍDER DE REC
                                 → um cargo de liderança de REC confirma
                                 → aplica cargos + credita pontos + anuncia
                                 → thread arquiva
```

Mais três itens independentes:

- **fim do rank automático** (a pessoa acumula pontos, mas não sobe/desce de
  cargo de rank sozinha);
- **comando de reset de pontos totais**;
- **painel só de texto** (botões opcionais).

Decisões fechadas com o dono do produto (ver seção 9).

---

## 1.1. Configurabilidade (o que é da plataforma, o que é do código)

Segue a convenção que já existe: **config de negócio** e as **superfícies de
mensagem** ficam em `recruitmentConfigs/{guildId}` (escrito só pela
plataforma); o **scaffolding dos comandos** fica em código, como em
`/pontos-dar` / `/pontos` hoje.

**Configurável pela plataforma:**

- painel de verificação inteiro (texto, `layout`, cor, imagem, botão) —
  editor de painel;
- `verificationTicket`: `parentChannelId`, `threadNameTemplate`,
  `openMessage`, `escalationMessage`, `closeMessage`,
  `escalateAfterMinutes`, `recruiterPickerPlaceholder`, `noRecruiterLabel`;
- `familyAreaId`; `familyRoute` / `areaRoute` (canal da ficha + cargos
  aprovadores por rota);
- `pointsResetRoleIds`;
- `blockedAlreadyInFamilyMessage` (junto das outras mensagens de bloqueio);
- `maxAreas` (já era) e tudo que a spec de multi-etapas já cobre.

**Fica no código (não configurável), igual aos comandos de hoje:**

- feedback inline dos comandos (`"Zerei os pontos de <@..>"`, `"A
  quantidade precisa ser diferente de zero"`, labels do diálogo de
  confirmação do `/pontos-resetar`);
- nomes de eventos de log;
- o **rank base** (`hierarchyRoles`) — editável direto no Firestore, como
  já é hoje, sem UI na plataforma.

---

## 2. Ponto de entrada: painel de texto

### 2.1. `PanelKind` ganha `"text"`

`src/domain/types.ts`:

```ts
export type PanelKind = "buttons" | "select" | "text";
```

- `text`: mensagem informativa (título/descrição/imagem/cor), com **0..25
  botões opcionais** e **sem** dropdown (`select` fica `null`).
- Continua valendo tudo o que já existe para os outros kinds: alternar
  `layout: "embed" | "container"`, cor lateral (`color`), emoji nos botões.
- `buildPanelMessage` (`src/commands/painel.ts`): quando
  `kind === "text"`, monta a mensagem como no `buttons`, mas **não exige**
  `buttons.length >= 1` — se `buttons` estiver vazio, envia só a
  mensagem, sem `ActionRow`.
- `mapPanel` (`FirestoreDragonsStore.ts`): `kind` já tem backfill para
  `"buttons"`; aceitar o novo valor sem mudança de default.

Sem migração: documentos existentes não têm `kind === "text"`.

### 2.2. Botão "Verificar-se" = ação `run` `verification-ticket`

O painel de verificação é um painel `kind: "text"` (ou `buttons`) com **um**
botão cuja `action` é:

```jsonc
{ "type": "run", "actionId": "verification-ticket", "params": {} }
```

`src/domain/types.ts`:

```ts
export const PANEL_ACTION_IDS = ["support-ticket", "verification-ticket"] as const;
```

`src/commands/panel-actions/registry.ts`: registrar
`"verification-ticket": openVerificationTicket`.

Novo módulo `src/commands/panel-actions/verification-ticket.ts` (detalhe na
seção 4).

---

## 3. Configuração: `recruitmentConfigs/{guildId}` ganha três blocos

O documento continua sendo **escrito só pela plataforma**; o bot só lê.
`RecruitmentFlowConfig` (e o espelho em `shared/src/recruitment-config.ts`)
ganha:

```ts
export interface RecruitmentVerificationTicketConfig {
  /** Canal de texto onde nasce a thread privada do ticket de verificação. */
  parentChannelId: string | null;
  /** Nome da thread. Vars: {user} {date} {shortid}. */
  threadNameTemplate: string;
  /** Texto do primeiro post da thread. Vars: {user} {recruiter}. */
  openMessage: string;
  /** Texto do post de escalonamento (menção ao cargo recruiter). Vars: {user}. */
  escalationMessage: string;
  /** Texto postado ao fechar/arquivar a thread. Vars: {user} {closer}. */
  closeMessage: string;
  /** Minutos sem recrutamento até marcar todo o cargo `recruiter`. Default 60. */
  escalateAfterMinutes: number;
  /** Placeholder do select "Veio por alguém?". */
  recruiterPickerPlaceholder: string;
  /** Label da opção "entrei por conta própria". */
  noRecruiterLabel: string;
}

export interface RecruitmentRouteConfig {
  /** Canal onde a ficha dessa rota é postada. `null` = rota não configurada. */
  sheetChannelId: string | null;
  /** Cargos que podem Confirmar/Rejeitar a ficha dessa rota. */
  approverRoleIds: string[];
}

export interface RecruitmentFlowConfig {
  // ... campos atuais ...

  verificationTicket: RecruitmentVerificationTicketConfig;

  /** Qual `RecruitmentAreaOption.id` conta como "recrutamento para a Família". */
  familyAreaId: string | null;
  /** Rota Família: ficha vai para os Founders ("Verificação das Posses"). */
  familyRoute: RecruitmentRouteConfig;
  /** Rota Área: ficha vai para a liderança de REC. */
  areaRoute: RecruitmentRouteConfig;

  /** Cargos que podem rodar `/pontos-resetar`. Vazio = cai em `pointsGrantRoleIds`. */
  pointsResetRoleIds: string[];
  /** Bloqueio do `/recrutar` quando o membro já tem recrutamento Família aprovado. */
  blockedAlreadyInFamilyMessage: string;
}
```

### 3.1. Migração do `sheet` atual

Hoje o roteamento da ficha usa `sheet.channelId` (topo) e
`approverRoleIds` (topo do `RecruitmentFlowConfig`). Passa a usar
`familyRoute` / `areaRoute`.

- `sheet.channelId` e o `approverRoleIds` do topo **continuam existindo**
  como fallback dos recrutamentos legados (fichas já postadas guardam
  `sheetPresentation`, então não quebram).
- `DEFAULT_RECRUITMENT_FLOW_CONFIG`: `familyRoute` e `areaRoute` nascem com
  `sheetChannelId: null` e `approverRoleIds: []` → enquanto a plataforma
  não configurar, `/recrutar` responde `notConfiguredMessage` para a rota
  correspondente.
- Sem script de migração de dados: a plataforma reescreve o documento na
  primeira vez que a tela de Recrutamento salvar. Documentar a mudança de
  forma no README.

### 3.2. `maxAreas` default → 1

`DEFAULT_RECRUITMENT_FLOW_CONFIG.maxAreas: 1` (era `2`). Evita seleção
múltipla e mistura de rotas. Continua editável na plataforma; a validação
lá permite `1 <= minAreas <= maxAreas <= min(25, areas.length)`.

Regra de rota (na etapa 3 / no job de confirmação):

- se `familyAreaId` está entre as áreas escolhidas → **rota Família**;
- senão → **rota Área**.

Se por config o servidor deixar `maxAreas > 1` e alguém marcar Família +
outra área, Família ganha (rota Família).

---

## 4. Ticket de verificação (reaproveita a infra de tickets)

### 4.1. `TicketRecord` ganha campos

`src/domain/types.ts`:

```ts
export type TicketKind = "support" | "verification";

export interface TicketRecord {
  // ... campos atuais ...
  kind: TicketKind;                     // ausente no doc = "support"
  /** Só verification: recrutador que o membro declarou no formulário. */
  declaredRecruiterUserId: string | null;
  /** Só verification: quando marcar todo o cargo `recruiter`. `null` após escalar ou se não aplicável. */
  escalateAt: string | null;
  escalatedAt: string | null;
  /** Só verification: recrutamento aberto dentro desta thread, quando houver. */
  recruitmentId: number | null;
}
```

`CreateTicketInput` ganha `kind`, `declaredRecruiterUserId`,
`escalateAt`. `mapTicket` (`FirestoreDragonsStore.ts`): backfill de `kind`
para `"support"` e dos campos novos para `null`.

Store (`DragonsStore` + Firestore):

- `linkTicketRecruitment(ticketId, recruitmentId)` — grava
  `recruitmentId` e zera `escalateAt` (não escala mais).
- `markTicketEscalated(ticketId)` — seta `escalatedAt`, zera `escalateAt`.
- `listTicketsToEscalate(nowIso)` — `kind == "verification"`,
  `status in ("open","claimed")`, `escalateAt != null`,
  `escalateAt <= now`. Usado pelo worker.
- `getVerificationTicketByThread(guildId, threadId)` — para o `/recrutar`
  saber se está rodando dentro de um ticket.

`instrumentedStore`: `link` e `mark` já são prefixos de escrita
conhecidos; `list`/`get` são leitura. Sem mudança em `WRITE_PREFIXES`.

A **trava de 1 ticket aberto por usuário** (`openTicketKeys/{guildId}_{userId}`)
é a mesma. Um membro não pode ter ticket de suporte e de verificação ao
mesmo tempo — aceitável (é raro e o de verificação some ao ser recrutado).

### 4.2. `openVerificationTicket` (novo `src/commands/panel-actions/verification-ticket.ts`)

Acionado pelo botão do painel. Fluxo:

1. `deferReply({ flags: Ephemeral })`.
2. Lê `recruitmentConfigs/{guildId}`. Se
   `verificationTicket.parentChannelId` nulo ou canal inválido → erro
   "avise a administração" + log `verification_ticket.open_denied`.
3. Monta a **lista de recrutadores**: membros do guild com
   `guildConfig.recruiterRoleId`. Ordena por `displayName`. Regra de
   produto: no máximo ~20 recrutadores, então cabe no limite de 25 opções
   do select (com a opção "Nenhum" = 21). Se passar de 24, trunca e loga
   `verification_ticket.recruiter_list_truncated` (não deve acontecer).
4. `editReply` com um `StringSelectMenuBuilder`:
   - `custom_id = verifyrec:pick:{guildId}`
   - uma option por recrutador (`value = userId`, `label = displayName`)
   - + option final `value = "none"`, `label = noRecruiterLabel`
   - `placeholder = recruiterPickerPlaceholder`
   - **não** cria o ticket ainda (evita thread órfã se o membro fechar o
     ephemeral).

### 4.3. `verificationTicketPickHandler` (novo `SelectMenuHandler`, prefixo `verifyrec:`)

1. `deferUpdate` (ou `deferReply` ephemeral).
2. `claimTicketSlot(guildId, userId)` — se falso, "você já tem um ticket
   aberto", fim.
3. `declaredRecruiterUserId = value === "none" ? null : value`.
4. Cria a **thread privada** em `verificationTicket.parentChannelId`
   (`ChannelType.PrivateThread`, `invitable: false`), nome por
   `threadNameTemplate`.
5. `thread.members.add(userId)`.
6. Primeiro post da thread:
   - `declaredRecruiterUserId` != null → `content` menciona **esse
     recrutador** (`<@id>`), `allowedMentions.users = [id]`, corpo =
     `renderTemplate(openMessage, { user, recruiter })`.
   - `declaredRecruiterUserId` == null → `content` menciona o cargo
     `recruiterRoleId` (`<@&id>`), `allowedMentions.roles = [recruiterRoleId]`.
   - Anexa a `ActionRow` com o botão **"Fechar ticket"** (reusa
     `buildTicketActionRow` — `claimDisabled: true`, só "Fechar" ativo; o
     ticket de verificação não tem "Atender").
7. `escalateAt`:
   - `declaredRecruiterUserId` != null → `now + escalateAfterMinutes`.
   - `declaredRecruiterUserId` == null → `null` (não escala; já foi para o
     cargo todo).
8. `createTicket({ ..., kind: "verification", declaredRecruiterUserId, escalateAt })`.
9. `editReply` → "Ticket criado: <#threadId>".
10. Log `verification_ticket.opened`.

Falha em qualquer passo pós-`claimTicketSlot` → `releaseTicketSlot` +
`verification_ticket.open_failed`.

### 4.4. Botão "Fechar ticket"

Reusa `ticketActionButtonHandler` / `ticketact:close:{ticketId}` já
existente. Ajustes:

- validação de permissão: para `kind === "verification"`, quem pode
  fechar é o cargo `recruiterRoleId` (hoje o handler valida
  `category.supportRoleIds`). Ramificar por `ticket.kind`.
- ao fechar: `releaseTicketSlot`, posta
  `renderTemplate(verificationTicket.closeMessage, { user, closer })`,
  remove o autor da thread, `setLocked(true)` + `setArchived(true)`.

### 4.5. Worker de escalonamento

Novo `startVerificationTicketEscalationWorker(client, store)` em
`verification-ticket.ts`, iniciado no `ClientReady` (junto com os outros).
Padrão do `startRecruitmentDraftExpiryWorker`: `setTimeout` recorrente
(60s, sem `onSnapshot` — volume baixíssimo).

A cada tick: `listTicketsToEscalate(now)` → para cada ticket:

1. Busca a thread. Se sumiu → `markTicketEscalated` (não retenta).
2. Post: `renderTemplate(escalationMessage, { user })` mencionando
   `<@&recruiterRoleId>`, `allowedMentions.roles = [recruiterRoleId]`.
3. `markTicketEscalated(ticketId)`.
4. Log `verification_ticket.escalated`.

`recruitmentId != null` já zerou `escalateAt` em
`linkTicketRecruitment` — então recrutamento em andamento não escala.

`shutdown()` no `src/index.ts` para o worker.

---

## 5. `/recrutar` dentro da thread + roteamento da ficha

### 5.1. `/recrutar` continua igual, com um vínculo a mais

O comando não muda de assinatura nem de wizard. Quando `interaction.channel`
é uma thread e `getVerificationTicketByThread(guildId, threadId)` acha um
ticket `verification` aberto:

- ao criar o `Recruitment` (no submit da etapa 3), chama
  `linkTicketRecruitment(ticket.id, recruitment.id)` — isso zera o
  `escalateAt` do ticket.
- o `Recruitment` guarda `ticketId: string | null` e `ticketThreadId:
  string | null` (campos novos, escrita exclusiva do bot).

`/recrutar` **continua funcionando fora de thread** (recrutar quem já é
membro para uma área nova — comportamento atual). Nesse caso `ticketId`
fica `null` e nada de ticket acontece.

Guard novo: `/recrutar` recusa se o membro **já tem um `Recruitment`
`approved` na rota Família** (`familyAreaId` entre as áreas de um
recrutamento aprovado) — responde `blockedAlreadyInFamilyMessage`. Isso
cobre o "não pode ser feito de novo".

### 5.2. Roteamento da ficha

No submit da etapa 3, o bot decide a rota:

```ts
const route = draft.areaIds.includes(config.familyAreaId ?? "")
  ? config.familyRoute
  : config.areaRoute;
```

- ficha postada em `route.sheetChannelId` (não mais `sheet.channelId`);
- se `route.sheetChannelId` for `null` → responde `notConfiguredMessage`
  e **não** cria o recrutamento;
- o `sheetPresentation` congelado no `Recruitment` ganha o `routeKind:
  "family" | "area"` e os `approverRoleIds` da rota (congelados, como o
  resto);
- o job `approve_recruitment` valida
  `memberHasAnyRole(approver, recruitment.sheetPresentation.approverRoleIds)`
  em vez do `flowConfig.approverRoleIds` do topo.

Template da ficha (título/texto/cor/botões): **um só**, reaproveitado nas
duas rotas (decisão 9.B). Sem textos separados por rota.

### 5.3. Confirmação da ficha

O job `approve_recruitment` já: aplica `member` + cargos de iniciante/área,
credita os pontos congelados ao **recrutador do recrutamento**, marca a
entrada, anuncia no canal de recrutamento, edita a ficha para "aprovada".

Mudanças:

1. **Remover** a chamada a `syncMemberRankRoles` (seção 6).
2. Se `recruitment.ticketId != null` **e** rota Família:
   - apaga a **mensagem do wizard/`/recrutar`** que ficou na thread
     (o bot já guarda o `messageId` do rascunho; apagar se ainda existir);
   - `setLocked(true)` + `setArchived(true)` na thread;
   - `releaseTicketSlot(guildId, recruitUserId)`;
   - `closeTicket(ticket.id, approverUserId)`;
   - log `verification_ticket.recruited_family`.
3. Se `recruitment.ticketId != null` **e** rota Área:
   - `setArchived(true)` na thread (sem lock — o líder de REC "dá
     continuidade" no processo dele);
   - `closeTicket` + `releaseTicketSlot`;
   - log `verification_ticket.recruited_area`.

"Rejeitar" a ficha: como hoje (nada de cargo/ponto, entrada volta a ficar
livre). A thread **não** é fechada — o recrutador pode rodar `/recrutar` de
novo ali.

### 5.4. Card automático de `GuildMemberAdd` sai

`announceNewMember` (chamado no `GuildMemberAdd`) deixa de postar o card na
fila `verification`. A porta única passa a ser o painel "Verificar-se".

- `announceNewMember` continua criando/garantindo o `MemberEntry`
  (`status: "pending"`), só não posta card nem menciona `founder`.
- `/verificar` (verificação direta por Founder) **continua existindo** como
  atalho de emergência, sem mudança.
- O botão `member:verify:` do card antigo e o handler continuam
  registrados até drenarem os cards já postados; podem ser removidos num
  PR de limpeza depois.

---

## 6. Fim do rank automático

Requisito: "o membro não deve subir de cargo automaticamente; qualquer
mudança de cargo segue o sistema da administração". Mas **os pontos
continuam acumulando** (para `/ranking` e histórico) e **`/pontos-dar`
continua funcionando** (muda o valor de pontos).

Mudanças:

- `processApproveRecruitmentJob` (`recrutar.ts`): remover
  `syncMemberRankRoles(...)` e o bloco de DM "você subiu para o rank X".
  Continua creditando `points`/`recruitments` via
  `approveRecruitmentAndAddMemberPoints`.
- `/pontos-dar` (`src/commands/pontos-dar.ts`): remover a sincronização de
  cargo de rank pós-gravação. Continua alterando `points` e respeitando
  `min/maxManualPoints`.
- `applyMemberRoles`: **mantém** aplicar o cargo `member` e o **cargo de
  rank base** (`Novato`) na entrada — isso é o baseline do membro, não uma
  "subida" (decisão 9.K).
- `hierarchyRoles` / `HierarchyRole` / `DEFAULT_HIERARCHY_ROLES`: **ficam**
  como dado de exibição do `/ranking` e do `rankName` no `MemberProfile`.
  `syncMemberRankRoles` (`src/utils/rankRoles.ts`) fica sem callers → pode
  ser deletado no mesmo PR ou marcado `@deprecated` e removido depois.
- `MemberProfile.rankName` / `rankRoleId`: continuam sendo gravados (o
  `ensureMemberProfile` calcula pelo total de pontos), só não viram mais
  `roles.add/remove`. `/ranking` e `/pontos` seguem mostrando o rank
  "teórico".

README: seção "Hierarquia" reescrita para deixar claro que a atribuição de
cargo de rank é **manual**.

---

## 7. Comando de reset de pontos totais

Novo subcomando em `src/commands/pontos-dar.ts` (ou comando próprio
`/pontos-resetar`; subcomando é mais enxuto se `pontos-dar` já for um
grupo — hoje é comando solto, então **comando novo `/pontos-resetar`**).

```
/pontos-resetar usuario:<membro>        # zera um membro
/pontos-resetar todos:True              # zera todos os membros do guild (confirmação)
```

- Exatamente **um** de `usuario` / `todos` é obrigatório.
- Autorização: cargo em `pointsResetRoleIds` (seção 3). Se vazio, cai em
  `pointsGrantRoleIds` (mesma regra de `/pontos-dar`). Não usa permissão
  do Discord. Bloqueio responde `notApproverMessage` (reaproveitado).
- `todos:True`: `deferReply` ephemeral + `ActionRow` com botão
  **"Confirmar reset geral"** (`custom_id = pontosreset:confirm:{guildId}`,
  `Danger`) + "Cancelar". Só quem rodou o comando pode clicar. Sem clique
  em 60s → expira.
- Efeito: zera **só `points`** (não mexe em `recruitments` — decisão 9.G).
  `rankName`/`rankRoleId` são recalculados para o rank base pelo
  `ensureMemberProfile`/store, mas **nenhum cargo é mexido** (coerente com
  a seção 6).
- Store: `resetMemberPoints(guildId, userId)` e
  `resetAllMemberPoints(guildId): Promise<number>` (retorna quantos
  perfis zerou). Prefixo `reset` → adicionar a `WRITE_PREFIXES` no
  `instrumentedStore`.
- Log: `points.reset` (`{ guildId, byUserId, scope: "member"|"guild",
  targetUserId?, affected }`).

---

## 8. Coleções e eventos de log

Coleções: nenhuma nova. `tickets` ganha campos; `recruitmentConfigs` ganha
campos; `recruitments` ganha `ticketId`/`ticketThreadId`.

Eventos de log novos:

- `verification_ticket.opened`
- `verification_ticket.open_denied`
- `verification_ticket.open_failed`
- `verification_ticket.recruiter_list_truncated`
- `verification_ticket.escalated`
- `verification_ticket.recruited_family`
- `verification_ticket.recruited_area`
- `points.reset`

Eventos removidos/silenciados: os relacionados a `syncMemberRankRoles` e à
DM de subida de rank; o card de `member_entry` no `GuildMemberAdd`.

---

## 9. Decisões fechadas (com o dono do produto)

- **9.A** — A rota é decidida pela opção **"Familia"** estar marcada na
  etapa 2 do `/recrutar`. `maxAreas` default cai para **1** para evitar
  seleção múltipla e mistura. As `areas` **não mudam de forma** — só entra
  o ponteiro `familyAreaId` na config.
- **9.B** — Ficha com **um template único** reaproveitado nas duas rotas.
  Só mudam canal de destino e cargos aprovadores.
- **9.C** — O formulário "Veio por alguém?" só define **quem é mencionado
  na thread** e o **escalonamento de 1h**. Não roteia a ficha. A
  **pontuação não muda em nada**: vai sempre para quem roda `/recrutar`
  (comportamento atual). "Nenhum" → thread para o cargo `recruiter` todo.
- **9.D** — "Verificação das Posses" = cargo **Founder**. Rota Área =
  liderança de REC. Thread Família: fecha/arquiva quando o Founder
  confirma. Thread Área: arquiva quando o líder de REC confirma. Botão
  "Fechar ticket" manual continua disponível para o cargo `recruiter`.
- **9.E** — `/recrutar` continua podendo rodar **fora de thread** (recrutar
  quem já é membro para área nova). A thread é a porta de entrada dos
  novatos, não a única forma de usar o comando.
- **9.F** — Painel `kind: "text"` novo, botões **opcionais** (0..25).
  Mantém alternância embed/container, cor lateral e emoji, igual aos
  outros kinds.
- **9.G** — Reset de pontos zera **só `points`**, não `recruitments`.
  Cargo autorizado: `pointsResetRoleIds` novo, com fallback para
  `pointsGrantRoleIds` quando vazio. Modo `todos` exige confirmação por
  botão.
- **9.H** — Lista de recrutadores montada **ao vivo** dos membros com o
  cargo `recruiter`. Regra de produto: no máximo ~20 recrutadores, então
  não precisa de paginação nem curadoria na plataforma.
- **9.I** — Card automático de `GuildMemberAdd` **sai**. `/verificar`
  (Founder) fica como atalho de emergência.
- **9.J** — TAG da Dragons: **fora de escopo**. É setada manualmente em
  outro servidor, sem controle do bot. O fluxo do bot termina na
  confirmação da ficha.

### Micro-decisões resolvidas

- **9.K** — O **cargo de rank base** (`Novato`) **continua** sendo aplicado
  na entrada, junto com o cargo `member`. Só a *subida/descida* de rank
  deixa de ser automática (seção 6).
- **9.L** — Rota **Área**: o bot só **arquiva** a thread na confirmação da
  ficha, sem postar aviso de "dar continuidade".
- **9.M** — `/pontos-resetar` é **comando novo** (não subcomando de um
  grupo `/pontos`).

---

## 10. Ordem de implementação

1. **PR plataforma** (primeiro): `shared/src/recruitment-config.ts` +
   `panel.ts` (`kind: "text"`) + `recruitment-config-api.ts` (validação
   dos blocos novos) + repository + rota + telas
   (`RecruitmentConfigPage`, editor de painel) + README/AGENTS. Detalhe em
   `dragons-platform/docs/specs/2026-08-30-verificacao-recrutamento-por-ticket.md`.
2. **PR bot** (depois): tipos espelho, painel `text`,
   `verification-ticket.ts` + handler de select + worker de escalonamento,
   `TicketRecord`/store, roteamento da ficha no wizard/job, remoção do
   rank automático, `/pontos-resetar`, remoção do card de `GuildMemberAdd`,
   README + eventos de log.

---

## 11. Validação

`npm run build` (TypeScript `strict`). Sem suíte automatizada; o teste
fim a fim (painel → ticket → `/recrutar` → ficha → confirmação →
arquivamento, e o escalonamento de 1h) depende de credenciais
Discord/Firestore reais, indisponíveis em CI — reportar como **não
executado** e rodar manualmente no servidor de testes.
