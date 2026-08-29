# Recrutamento em 3 etapas + ficha aprovável (refac de `/recrutar`)

Data: 2026-08-29
Status: **Implementado** (PR 1 na `dragons-platform`, PR 2 no `dragonsbot`).
As divergencias entre o plano e o que foi construido estao marcadas com
**[na implementacao]**.
Escopo: **dois repositórios**, **um PR em cada** — `dragonsbot` (fluxo, cargos,
pontos) e `dragons-platform` (toda a configuração). Esta é a spec canônica; o
recorte do lado da plataforma está em
`dragons-platform/docs/specs/2026-08-29-recrutamento-multi-etapas.md`.

---

## 1. Contexto e o que muda

Hoje `/recrutar {usuario}`:

- exige o cargo de recrutador (`GuildConfig.recruiterRoleId`);
- cria `recruitments/{id}` e manda **DM para todos os Founders** com um botão
  "Adicionei na família";
- ao clicar, enfileira `memberActionJobs` (`approve_recruitment`), que aplica
  o cargo de membro + rank base e credita `GuildConfig.recruitmentPoints`
  (valor único) ao recrutador;
- há uma variante `kind: "credit"` para quem já é membro (originalmente
  restrita a uma janela de `recruitmentCreditWindowHours`; a janela foi
  removida — ver §8).

O novo fluxo mantém a assinatura (`/recrutar {usuario}`, usuário precisa estar
no servidor) e troca **tudo depois do enter**:

| Antes | Depois |
| --- | --- |
| Resposta efêmera + DM aos Founders | Mensagem pública no canal do comando, com wizard de 3 etapas |
| Sem escolha de cargo/área | Etapa 1 escolhe cargo de iniciante, etapa 2 escolhe até N áreas |
| Aprovação por DM de Founder | Ficha postada em canal configurável, aprovada/rejeitada por cargos de gerência |
| Pontos fixos (`recruitmentPoints`) | Pontos somados a partir das áreas escolhidas (família +6, recrutamento +8 → 14) |
| Embed fixo montado em código | Cada mensagem tem `layout: "embed" \| "container"`, título, descrição, cor, imagem, labels e **emojis** vindos do painel, congelados por recrutamento |
| Ids/cargos/textos em constantes e `/config` | **Tudo** configurável pelo painel `dragons-platform` |

Requisitos explícitos do pedido:

- a configuração desse fluxo é feita **só pelo painel**, não por comando
  `/config` novo (`/config` continua cobrindo o que já cobre);
- **cada etapa é personalizável** — título, texto, labels de botão e emojis —
  porque emojis serão adicionados depois, sem tocar em código;
- as mensagens seguem o **mesmo modelo de layout que os painéis já têm hoje**
  (`PanelLayout = "embed" | "container"`), escolhido no painel.

---

## 2. Fluxo alvo

Os blocos abaixo são o **conteúdo default** (`DEFAULT_RECRUITMENT_*`). Título e
descrição são templates com variáveis, então esse desenho é só o ponto de
partida — o painel reescreve qualquer parte.

### Etapa 1 — cargo de iniciante

Mensagem no canal onde o comando foi usado (pública, mas só o autor opera os
componentes):

```
Recrutamento - etapa 1/3
- Recrutado: @fulano
- Cargo: Aguardando seleção
- Area: Aguardando

Selecione o cargo de iniciante

[select: Selecione o cargo de iniciante]
[Cancelar]
```

Opções default do dropdown (lista, ordem, label, descrição e emoji
configuráveis): Mystic, Revenge, Swag, Lotus, Hope, Delusions. Cada opção
mapeia para **um** `roleId`.

### Etapa 2 — áreas

```
Recrutamento - etapa 2/3
- Recrutado: @fulano
- Cargo: Hope
- Area: Aguardando seleção..

Selecione até 2 áreas

[select: Selecione as áreas]  (min 1, max 2 — configurável)
[Voltar] [Cancelar]
```

Opções default: Família, Recrutamento, Passtime, Suporte. Cada área mapeia para
**uma ou mais** roles e tem pontuação própria:

| Área | Cargos aplicados | Pontos ao recrutador |
| --- | --- | --- |
| Família | Novato + Dragons Member | 6 |
| Recrutamento | Recrutador | 8 |
| Passtime | Passtime | 0 |
| Suporte | Suporte | 0 |

`Voltar` volta à etapa 1 mantendo o rascunho (permite trocar o cargo).

### Etapa 3 — confirmação

```
Confirmar recrutamento
- Recrutado: @fulano
- Cargo: Hope
- Areas: Família, Recrutamento

Confirme para aplicar os cargos e gerar a ficha

[Confirmar] [Reiniciar] [Cancelar]
```

`Reiniciar` zera as seleções e volta à etapa 1. `Cancelar` encerra o rascunho e
edita a mensagem para o texto configurável de cancelamento (sem componentes).

### Ficha (canal configurável)

Após `Confirmar`, o wizard é encerrado (mensagem editada para o texto de
"ficha enviada") e o bot posta no canal de fichas:

```
Ficha de recrutamento
[avatar do recrutado]

Recrutador: @recrutador
Recrutado: @recrutado
Cargo: Hope
Areas: Família, Recrutamento
Conta criada: <t:...:F>

<timestamp>

[Confirmar] [Rejeitar]
```

Só quem tem um dos `approverRoleIds` (gerência/líderes, configurável) pode
clicar. `Confirmar` enfileira o job que aplica os cargos e credita os pontos;
`Rejeitar` marca o recrutamento como `rejected`. Nos dois casos a ficha é
editada para a versão de desfecho e os botões viram desabilitados com label
(e emoji) configuráveis.

### Referência visual

Existe uma implementação de referência (bot de outro servidor) que é o alvo
estético. O que ela mostra e que o modelo desta spec precisa suportar:

- **Layout `container`** nas quatro mensagens: barra de accent colorida à
  esquerda, título em `##` com emoji customizado do servidor — coisa que o
  `title` de embed não renderiza.
- **Uma linha por campo**, no formato `{emoji} **Label:** {valor}`, com o valor
  em `` `code` `` ou como menção (`<@id>` / `<@&id>`). Isso é markdown livre
  dentro de `description` — nenhum campo novo é necessário, mas os defaults
  devem já vir nesse formato.
- **Campos aparecem desde a etapa 1** preenchidos com o texto de "aguardando" e
  vão sendo substituídos conforme o wizard avança.
- **Avatar do recrutado como thumbnail à direita** na ficha (não banner no
  topo) — em Components V2 isso é um `SectionBuilder` com
  `setThumbnailAccessory`, não `MediaGallery`. Ver §4.2.
- **Botões com emoji**, e na ficha **só emoji** (✅ / ❌), sem texto. O `label`
  precisa ser opcional quando há emoji.
- **Ficha** mostra o ID copiável junto da menção e a data de criação da conta
  com carimbo absoluto + relativo (`<t:...:F> (<t:...:R>)`).

Um campo da referência fica **fora de escopo por decisão**: o `Up:` (uma área
única, ao lado da lista de áreas). É específico do servidor de origem; o fluxo
aqui tem 3 etapas — cargo, áreas, confirmação. Se voltar à mesa depois, entra
como uma 4ª etapa opcional sem quebrar o modelo (é mais uma seleção no
rascunho + mais uma linha na `description`).

Armadilha vista na própria referência: os emojis da ficha aparecem como texto
cru (`:settings_purple:`). Shortcode **não** é resolvido pela API do Discord —
emoji customizado tem que ser `<:nome:id>` (ou `<a:nome:id>` se animado). A
validação do painel (PR 1) rejeita shortcode com essa mensagem.

---

## 3. Modelo de dados

### 3.1 Config do fluxo — `recruitmentConfigs/{guildId}`

Escrita **só** pela `dragons-platform`; o bot só lê (mesmo contrato de
`supportCategories`). Novos tipos em `src/domain/types.ts`, espelhados em
`dragons-platform/shared/src/recruitment-config.ts`.

#### Blocos reaproveitados do painel

`PanelLayout` (`"embed" | "container"`) e `PanelButtonStyle` já existem em
`src/domain/types.ts` — **reusar**, não criar tipos paralelos.

```ts
/** Uma mensagem do fluxo, no mesmo modelo das mensagens de painel. */
export interface RecruitmentMessageConfig {
  layout: PanelLayout;      // "embed" (default) | "container"
  title: string;            // template; emoji unicode ou <:nome:id> no layout container
  description: string;      // template markdown com as variáveis da §3.2
  imageUrl: string | null;  // banner no topo (container) / image (embed)
  color: string | null;     // accent do container / cor do embed
}

/**
 * Um botão do fluxo — label, emoji e estilo configuráveis. `label` vazio é
 * válido desde que haja `emoji` (os botões da ficha na referência são só
 * ✅ / ❌); o inverso também. Os dois vazios é erro de validação.
 */
export interface RecruitmentButtonConfig {
  label: string;            // "" = botão só com emoji
  emoji: string | null;     // unicode ou custom `<:nome:id>` — nunca `:shortcode:`
  style: PanelButtonStyle;
}

/** Um dropdown do fluxo. As options vêm de `starterRoles` / `areas`. */
export interface RecruitmentSelectConfig {
  placeholder: string;
}
```

#### Opções do wizard

```ts
export interface RecruitmentStarterRoleOption {
  id: string;              // slug estável, ex.: "hope"
  label: string;
  description: string | null;
  emoji: string | null;
  roleId: string;          // cargo aplicado na aprovação
  order: number;
}

export interface RecruitmentAreaOption {
  id: string;              // "familia" | "recrutamento" | "passtime" | "suporte" | ...
  label: string;
  description: string | null;
  emoji: string | null;
  roleIds: string[];       // 1..n cargos aplicados (ex.: Novato + Dragons Member)
  points: number;          // pontos creditados ao recrutador
  order: number;
}
```

#### As etapas

```ts
export interface RecruitmentStepOneConfig {
  message: RecruitmentMessageConfig;
  select: RecruitmentSelectConfig;
  cancelButton: RecruitmentButtonConfig;
}

export interface RecruitmentStepTwoConfig {
  message: RecruitmentMessageConfig;
  select: RecruitmentSelectConfig;
  backButton: RecruitmentButtonConfig;
  cancelButton: RecruitmentButtonConfig;
}

export interface RecruitmentStepThreeConfig {
  message: RecruitmentMessageConfig;
  confirmButton: RecruitmentButtonConfig;
  restartButton: RecruitmentButtonConfig;
  cancelButton: RecruitmentButtonConfig;
}

/** Estados finais do wizard — mensagem sem componentes. */
export interface RecruitmentOutcomeConfig {
  submitted: RecruitmentMessageConfig;  // "ficha enviada para aprovação"
  cancelled: RecruitmentMessageConfig;
  expired: RecruitmentMessageConfig;
}

export type RecruitmentAvatarPlacement = "thumbnail" | "image" | "none";

export interface RecruitmentSheetConfig {
  channelId: string | null;
  message: RecruitmentMessageConfig;
  approveButton: RecruitmentButtonConfig;
  rejectButton: RecruitmentButtonConfig;
  /** Estados da ficha depois do clique — botões desabilitados. */
  queued: RecruitmentMessageConfig;
  approved: RecruitmentMessageConfig;
  rejected: RecruitmentMessageConfig;
  approvedButton: RecruitmentButtonConfig;   // label/emoji do botão travado
  rejectedButton: RecruitmentButtonConfig;
  /**
   * Onde entra a foto do recrutado. `thumbnail` = canto direito (accessory de
   * `Section` no container, `setThumbnail` no embed) — é o formato da
   * referência. `image` = banner (MediaGallery no container, `setImage` no
   * embed). `none` = sem foto.
   */
  avatarPlacement: RecruitmentAvatarPlacement;
  mentionApprovers: boolean;
}
```

#### O documento

```ts
export type RecruitmentPointsMode = "sum" | "highest";

export interface RecruitmentFlowConfig {
  guildId: string;
  starterRoles: RecruitmentStarterRoleOption[];
  areas: RecruitmentAreaOption[];
  minAreas: number;                 // default 1
  maxAreas: number;                 // default 2
  stepOne: RecruitmentStepOneConfig;
  stepTwo: RecruitmentStepTwoConfig;
  stepThree: RecruitmentStepThreeConfig;
  outcome: RecruitmentOutcomeConfig;
  sheet: RecruitmentSheetConfig;
  approverRoleIds: string[];        // quem Confirma/Rejeita a ficha
  pointsGrantRoleIds: string[];     // quem pode usar o comando manual de pontos
  pointsMode: RecruitmentPointsMode;   // default "sum"
  minManualPoints: number;          // default -100
  maxManualPoints: number;          // default 100
  draftTtlMinutes: number;          // default 15
  /** Mensagens de erro efêmeras, também configuráveis. */
  notRecruiterMessage: string;
  notApproverMessage: string;
  notDraftOwnerMessage: string;
  notConfiguredMessage: string;
  createdAt: string;
  updatedAt: string;
}
```

Defaults em código (`DEFAULT_RECRUITMENT_FLOW_CONFIG`) seguindo o padrão já
usado por `GuildConfig`/`mapPanel`: a store preenche campo ausente com o
default ao mapear o documento, para documento antigo/parcial nunca quebrar o
bot. `sheet.channelId: null` ou `starterRoles: []` são estados válidos — o
comando responde `notConfiguredMessage` em vez de falhar.

### 3.2 Templates e variáveis

Título e descrição de toda `RecruitmentMessageConfig` passam por
`renderTemplate` (já existe em `src/utils/discord.ts`). Variáveis disponíveis:

| Variável | Valor |
| --- | --- |
| `{step}` / `{total}` | etapa atual / total (3) |
| `{recruited}` / `{recruiter}` | menção (`<@id>`) |
| `{recruitedTag}` / `{recruiterTag}` | `user.tag` |
| `{role}` | label do cargo escolhido, ou o texto de "aguardando" quando ainda não escolhido |
| `{areas}` | labels separados por `, ` (ou "aguardando") |
| `{min}` / `{max}` | limites de área |
| `{points}` | pontos calculados |
| `{createdAt}` | `<t:...:F>` da criação da conta do recrutado |
| `{approver}` | quem confirmou/rejeitou (só nos estados de desfecho) |

Os defaults de `description` reproduzem o formato da referência — uma linha por
campo, `{emoji} **Label:** {valor}` — e ficam inteiramente editáveis.

Não existe campo separado para "Aguardando seleção": os textos de placeholder
de `{role}` e `{areas}` são dois campos da config (`rolePendingText`,
`areasPendingText`), e o resto é markdown livre na `description`. Isso é o que
torna cada linha da mensagem editável e permite emoji em qualquer posição —
inclusive no título, que é markdown quando `layout: "container"` (o `title` de
embed não renderiza emoji customizado do servidor; é exatamente a razão de o
layout container existir, ver `2026-08-27-painel-layout-container.md`).

### 3.3 Rascunho do wizard — `recruitmentDrafts/{draftId}`

O wizard não pode viver só no `customId` (ids de cargo/área estouram os 100
chars) nem em memória (o bot reinicia). Um doc por rascunho:

```ts
export type RecruitmentDraftStatus =
  | "selecting_role" | "selecting_areas" | "confirming"
  | "submitted" | "cancelled" | "expired";

export interface RecruitmentDraft {
  id: string;                 // usado no customId
  guildId: string;
  channelId: string;
  messageId: string | null;
  recruiterUserId: string;
  recruitUserId: string;
  kind: RecruitmentKind;      // "standard" | "credit" (mesma regra de hoje)
  status: RecruitmentDraftStatus;
  starterRoleId: string | null;
  areaIds: string[];
  /** Snapshot da apresentação no momento do `/recrutar` — ver §3.4. */
  presentation: RecruitmentPresentationSnapshot;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
```

### 3.4 Snapshot de apresentação (a regra que evita repostar)

**Regra**: a configuração é lida **uma vez**, no `/recrutar`, e congelada no
rascunho. Alterar o layout/texto/emoji no painel afeta **só recrutamentos
novos** — um wizard já aberto termina exatamente no formato em que começou, e
uma ficha já postada é editada (enfileirada → aprovada/rejeitada) no formato em
que foi criada.

```ts
/** Tudo que o wizard precisa para se desenhar, congelado na criação. */
export interface RecruitmentPresentationSnapshot {
  stepOne: RecruitmentStepOneConfig;
  stepTwo: RecruitmentStepTwoConfig;
  stepThree: RecruitmentStepThreeConfig;
  outcome: RecruitmentOutcomeConfig;
  starterRoles: RecruitmentStarterRoleOption[];
  areas: RecruitmentAreaOption[];
  minAreas: number;
  maxAreas: number;
  rolePendingText: string;
  areasPendingText: string;
  notDraftOwnerMessage: string;
}

/** Idem para a ficha, congelado no envio; vive no `Recruitment`. */
export type RecruitmentSheetSnapshot = RecruitmentSheetConfig;
```

Isso resolve três coisas de uma vez:

1. **Nada de repostar.** O Discord não deixa editar uma mensagem trocando entre
   embed e Components V2 — mas como o layout do rascunho nunca muda no meio do
   caminho, toda transição de etapa é um `edit` simples. O mesmo vale para a
   ficha: `sheet.queued`/`approved`/`rejected` herdam o layout do snapshot.

   **[na implementação]** Isso força uma restrição que o plano não tinha visto:
   as três etapas e os desfechos são a *mesma* mensagem, então não basta
   congelar — o layout precisa ser **único** entre elas. `buildPresentationSnapshot`
   normaliza tudo para o layout da **etapa 1** e loga
   `recruitment.layout_normalized` quando a configuração divergia. A ficha é
   outra mensagem e mantém layout próprio (que por sua vez manda nos seus três
   estados). A página de configuração explica isso ao usuário.
2. **Coerência de texto.** O recrutador não vê a etapa 2 com um vocabulário e a
   etapa 3 com outro porque alguém salvou o painel no meio.
3. **Histórico fiel.** A ficha continua descrevendo o que foi combinado quando
   foi criada.

Custo: dois documentos um pouco maiores (na casa de poucos KB, longe do limite
de 1 MB do Firestore) e o snapshot precisa ser regravado no `Reiniciar`? **Não**
— `Reiniciar` só zera as seleções; o snapshot é do `/recrutar` e permanece. Quem
quiser o formato novo cancela e roda `/recrutar` de novo.

### 3.5 `Recruitment` estendido

```ts
export type RecruitmentStatus = "pending" | "approved" | "rejected"; // + rejected

export interface Recruitment {
  // ...campos atuais
  starterRoleOptionId: string | null;
  starterRoleId: string | null;      // snapshot do cargo no momento do envio
  starterRoleLabel: string | null;   // snapshot do label (a ficha não re-lê a config)
  areaOptionIds: string[];
  areaRoleIds: string[];             // snapshot das roles das áreas
  areaLabels: string[];
  points: number;                    // snapshot dos pontos calculados
  sheetChannelId: string | null;
  sheetMessageId: string | null;
  sheetPresentation: RecruitmentSheetSnapshot;  // congelado no envio
  rejectedByUserId: string | null;
  rejectedAt: string | null;
}
```

Os snapshots são o ponto importante: mudar a config no painel **não** reescreve
recrutamentos já criados nem muda a ficha já postada.

### 3.6 Métodos novos no `DragonsStore`

Leitura (a plataforma escreve):

- `getRecruitmentFlowConfig(guildId): Promise<RecruitmentFlowConfig>`

Escrita (o bot é dono):

- `createRecruitmentDraft(input): Promise<RecruitmentDraft>`
- `getRecruitmentDraft(id): Promise<RecruitmentDraft | null>`
- `setRecruitmentDraftMessage(id, channelId, messageId)`
- `updateRecruitmentDraftSelection(id, { starterRoleId?, areaIds?, status })`
- `cancelRecruitmentDraft(id, reason)`
- `markRecruitmentDraftSubmitted(id, recruitmentId)`
- `expireStaleRecruitmentDrafts(): Promise<RecruitmentDraft[]>` — **[na implementação]** o documento vencido é **apagado**, não marcado como `expired`: o rascunho é transitório (tudo que importa já foi copiado para o recrutamento) e, sem apagar, a consulta por `expiresAt` devolveria os mesmos documentos para sempre. A consulta usa só `expiresAt` de propósito — combinar `status` com a desigualdade exigiria índice composto no Firestore.
- `setRecruitmentSheetMessage(id, channelId, messageId)`
- `rejectRecruitment(id, rejectedByUserId): Promise<Recruitment | null>` — transação, só `pending` → `rejected`

`createRecruitment` ganha os campos novos no input.

`src/storage/instrumentedStore.ts`: `expire` **não** é prefixo de escrita
conhecido — adicionar a `WRITE_PREFIXES` (`update` e `cancel` já estão).

---

## 4. Mudanças no bot, arquivo a arquivo

### 4.1 Quebra de `src/commands/recrutar.ts`

O arquivo tem 1556 linhas e vai crescer. Extrair para `src/commands/recruitment/`:

| Arquivo | Conteúdo |
| --- | --- |
| `recruitment/message.ts` | `buildRecruitmentMessage` — o equivalente de `buildPanelMessage` para este fluxo: monta embed **ou** container a partir da `RecruitmentMessageConfig` |
| `recruitment/wizard.ts` | `recrutarCommand`, snapshots, `buildStepMessage`, `recruitmentWizardSelectHandler` / `recruitmentWizardButtonHandler` (prefixo `rec:`) e o worker de expiração |
| `recruitment/sheet.ts` | `postRecruitmentSheet`, `buildSheetMessage`, `editSheetMessage`, `recruitmentSheetButtonHandler` (prefixo `recsheet:`) |
| `utils/rankRoles.ts` | `syncMemberRankRoles`, extraído do job de aprovação |

**[na implementação]** `recrutar.ts` **não** virou um barrel: ele continua
dono do que não mudou de comportamento — cards da fila de verificação,
`announceNewMember` / `announceMemberExit`, `verificarCommand`,
`verifyMemberButton`, o worker de `memberActionJobs` e o
`processApproveRecruitmentJob` (que precisou ser alterado de qualquer forma).
Mover esse código para `recruitment/member-entry.ts` e
`recruitment/approval-job.ts` seria um diff grande de puro deslocamento, com
risco real e sem ganho de leitura — o arquivo caiu para ~1.100 linhas e o
código novo, que é o que precisa ser revisado, está todo nos módulos novos.

### 4.2 `recruitment/message.ts` — o ponto que amarra o layout

Espelha `buildPanelMessage` (`src/commands/painel.ts:100-125`), com as mesmas
duas saídas:

- `layout: "embed"` → `{ embeds: [embed], components: rows }`, `imageUrl` em
  `setImage`, avatar em `setThumbnail`/`setImage` conforme `avatarPlacement`;
- `layout: "container"` → `ContainerBuilder` com `setAccentColor`, e dentro:
  - `imageUrl` (banner fixo da config) ou avatar com `avatarPlacement: "image"`
    → `MediaGalleryBuilder` no topo, como em `painel.ts`;
  - avatar com `avatarPlacement: "thumbnail"` → o texto vai num
    `SectionBuilder` com `setThumbnailAccessory(new ThumbnailBuilder()...)`,
    que é o que produz a foto no canto direito da referência; sem thumbnail,
    fica um `TextDisplayBuilder` solto (o que `painel.ts` já faz);
  - conteúdo `## {title}\n{description}`;
  - action rows dentro do container;
  - `flags: MessageFlags.IsComponentsV2`.

`SectionBuilder`/`ThumbnailBuilder` ainda não são usados no repo — são do mesmo
namespace de `ContainerBuilder` no discord.js já instalado.

A função recebe a `RecruitmentMessageConfig` **do snapshot do rascunho**
(§3.4), nunca da config viva. Por isso o layout de uma mensagem nunca muda
depois de postada e toda transição de etapa é um `message.edit` — o bot não
apaga nem reposta em momento nenhum. (O Discord não permitiria a troca de
qualquer forma: não dá para editar uma mensagem alternando entre embed e
Components V2; é a limitação que obrigou `painel.ts` a repostar. Aqui ela
simplesmente não é alcançável.)

### 4.3 Custom ids

- `rec:role:{draftId}` — select da etapa 1
- `rec:areas:{draftId}` — select da etapa 2 (`min_values`/`max_values` da config)
- `rec:back:{draftId}` / `rec:cancel:{draftId}` / `rec:restart:{draftId}` / `rec:confirm:{draftId}`
- `recsheet:approve:{recruitmentId}` / `recsheet:reject:{recruitmentId}`

`recruitment:approve:` (o handler antigo de DM) **fica** registrado, para não
quebrar aprovações que já estão nas DMs dos Founders no momento do deploy.

Guardas em todo handler do wizard: rascunho existe, `status` compatível com a
ação, `interaction.user.id === draft.recruiterUserId` (senão responde
`notDraftOwnerMessage` efêmero) e `expiresAt` não passou.

### 4.4 Aprovação e rejeição da ficha

`recsheet:approve` reaproveita a infra atual: valida `approverRoleIds` →
`enqueueMemberActionJob({ type: "approve_recruitment", ... })` → edita a ficha
para `sheet.queued`. O job (`recruitment/approval-job.ts`) muda em três pontos:

1. quem aprova é validado contra `approverRoleIds` (não mais `founderRoleId`);
2. depois de `applyMemberRoles` (cargo de membro + rank base, inalterado),
   chama `applyRecruitmentRoles`, que adiciona o `starterRoleId` e todos os
   `areaRoleIds` do recrutamento — cada `roles.add` é idempotente (só adiciona
   o que falta) e falha individual vira `logger.error` sem abortar o job;
3. os pontos vêm de `recruitment.points` (snapshot), não de
   `config.recruitmentPoints` — que fica como fallback quando `points` é `0`
   num recrutamento legado.

`recsheet:reject` é resolvido inline (não mexe em cargo nem em ponto, não
precisa de fila): `rejectRecruitment` em transação → edita a ficha para
`sheet.rejected` → novo status `recruitment_rejected` em `MemberEntryStatus`,
liberando um novo `/recrutar` para o mesmo usuário.

### 4.5 Sincronização de rank (extração)

O bloco que remove o rank antigo, adiciona o novo, manda DM de "você upou" e
loga `hierarchy.rank_up` está hoje embutido em `processApproveRecruitmentJob`
(`src/commands/recrutar.ts:603-672`). Extrair para `src/utils/rankRoles.ts`:

```ts
export async function syncMemberRankRoles(
  guild: Guild,
  userId: string,
  result: { member: MemberProfile; previousRankRoleId: string; rankChanged: boolean },
  logContext: Record<string, unknown>
): Promise<void>
```

Usado pelo job de aprovação **e** pelo comando manual de pontos.

### 4.6 Comando manual de pontos

Novo `src/commands/pontos-dar.ts`:

```
/pontos-dar usuario:<user> quantidade:<int> motivo:<string>
```

- permitido só para quem tem um dos `pointsGrantRoleIds` (config do painel) —
  quem não tem recebe `notApproverMessage` efêmero e o bloqueio é logado;
- `quantidade` aceita negativo (remoção manual), limitada por
  `minManualPoints` / `maxManualPoints`;
- chama `store.addMemberPoints(guildId, userId, quantidade, motivo)` e depois
  `syncMemberRankRoles`, para o cargo de rank acompanhar;
- loga `points.granted_manual` com
  `{ granterUserId, targetUserId, amount, reason, totalPoints, rankName, rankChanged }`;
- responde efêmero para quem executou.

`/pontos` (consulta) não muda.

### 4.7 Registro e worker

- `buttonHandlers` ganha `recruitmentWizardButtonHandler` e
  `recruitmentSheetButtonHandler`; `selectMenuHandlers` ganha
  `recruitmentWizardSelectHandler`.
- `commands` ganha `pontosDarCommand` → `npm run deploy:commands` no deploy.
- Um tick periódico no boot chama `expireStaleRecruitmentDrafts` e edita cada
  mensagem vencida para `outcome.expired` (sem componentes).

### 4.8 Cálculo de pontos

```ts
const areaPoints = selectedAreas.map((a) => a.points);
const points = config.pointsMode === "highest"
  ? Math.max(0, ...areaPoints)
  : areaPoints.reduce((acc, p) => acc + p, 0);
```

**Default `"sum"`**: Família (6) + Recrutamento (8) = **14**. `highest` fica
disponível no painel para quem quiser a outra regra.

---

## 5. Lado da `dragons-platform` (resumo)

Detalhe completo no arquivo irmão. Em resumo: tipos espelhados
(`shared/src/recruitment-config.ts` + `-api.ts` com validação),
`server/src/firestore/recruitment-config-repository.ts`,
`server/src/routes/recruitment-config.ts` (`GET`/`PUT`) e
`client/src/routes/RecruitmentConfigPage.tsx` com editor por etapa
(layout, título, descrição, cor, imagem, botões com emoji/estilo) reusando o
`discord-preview` e os pickers de cargo/canal que já existem.

---

## 6. Entrega: 2 PRs

Um PR por repositório. Dentro de cada um, a ordem de commits abaixo mantém o
review navegável — mas o PR só é aberto com tudo verde.

### PR 1 — `dragons-platform` (vai primeiro)

Vai primeiro para existir configuração real com que testar o bot.

1. `shared/`: tipos + defaults + validação do payload.
2. `server/`: repositório Firestore + rotas `GET`/`PUT /api/recruitment-config`.
3. `client/`: página de configuração (opções, canais/cargos, pontuação, e o
   editor de mensagem por etapa) + preview.
4. `README`/`AGENTS.md`: coleção `recruitmentConfigs` e a regra de espelho.

Fecha com `npm run check`.

### PR 2 — `dragonsbot`

1. **Commit de refac puro**: quebra de `recrutar.ts` em
   `src/commands/recruitment/*` sem mudança de comportamento.
2. Tipos (`domain/types.ts`) **idênticos** aos do PR 1 + defaults.
3. Store: `getRecruitmentFlowConfig`, CRUD de rascunho, `Recruitment`
   estendido, `rejectRecruitment`, `WRITE_PREFIXES`.
4. `recruitment/message.ts` (embed/container) + wizard das 3 etapas + expiração.
5. Ficha, `recsheet:approve/reject`, aplicação de cargos de iniciante/área,
   pontos por área. Sai o fan-out de DM aos Founders (handler legado fica).
6. `syncMemberRankRoles` extraído + `/pontos-dar`.
7. `README`/`AGENTS.md`: fluxo novo, coleções (`recruitmentConfigs`,
   `recruitmentDrafts`), eventos de log, e o lembrete de
   `npm run deploy:commands`.

Fecha com `npm run build`.

> Ordem de merge: PR 1 → PR 2. Os tipos das duas pontas precisam ser idênticos
> no mesmo dia (regra crítica do `AGENTS.md` da plataforma); merjar só um lado
> deixa os repos divergindo em silêncio.

---

## 7. Eventos de log novos

`recruitment.draft_created`, `recruitment.draft_blocked`,
`recruitment.draft_role_selected`, `recruitment.draft_areas_selected`,
`recruitment.draft_back`, `recruitment.draft_restarted`,
`recruitment.draft_cancelled`, `recruitment.draft_expired`,
`recruitment.sheet_sent`, `recruitment.sheet_channel_not_found`,
`recruitment.sheet_blocked` (clique sem cargo aprovador),
`recruitment.rejected`, `recruitment.area_role_add_failed`,
`recruitment.starter_role_add_failed`, `recruitment_config.missing`,
`points.granted_manual`, `points.grant_blocked`.

Todos no padrão `dominio.acao[_estado]` e documentados no README (convenção do
`AGENTS.md`).

---

## 8. Decisões tomadas e pontos em aberto

Fechadas:

- **Pontuação**: soma. Família + Recrutamento = 14. `pointsMode` continua no
  painel com `"highest"` como alternativa.
- **Entrega**: 2 PRs, um por repo, plataforma primeiro.
- **Layout**: `embed`/`container` por mensagem, mesmo modelo dos painéis. A
  apresentação é congelada no `/recrutar` (snapshot no rascunho) e no envio da
  ficha (snapshot no recrutamento): mudança no painel vale só para
  recrutamentos novos, e nada é reposto.

Fechada depois da implementação, corrigindo a proposta original:

- **Fluxo de crédito (`kind: "credit"`), sem guardas.** A proposta original
  mantinha, para quem já é membro, as mesmas guardas do fluxo antigo: exigir
  uma `MemberEntry` registrada pelo bot, dentro de uma janela de tempo
  (`recruitmentCreditWindowHours`), sem recrutador já creditado. Na prática
  isso bloqueava exatamente o caso que o fluxo novo existe para cobrir:
  recrutar alguém que **já está no servidor** para uma área nova (ex.:
  `Recrutamento`, `Passtime`), sem ser a família — produzindo a mensagem
  "Este usuario ja e membro e nao possui entrada recente registrada pelo bot
  para credito." mesmo sem nenhum problema real.

  A aprovação de uma ficha já exige um humano da gerência clicando
  `Confirmar` — isso substitui qualquer necessidade de janela de tempo ou de
  histórico de entrada como trava anti-abuso. Corrigido: `kind` continua
  computado (`"credit"` quando já é membro, só para rótulo/anúncio), mas as
  três guardas (`!memberEntry`, janela expirada, já creditado/pendente) foram
  **removidas** de `recrutarCommand` (`wizard.ts`) e do espelho delas em
  `processApproveRecruitmentJob` (`recrutar.ts`, que exigia o mesmo antes de
  aplicar os cargos). A mesma pessoa pode ser recrutada mais de uma vez, para
  áreas diferentes, sem limite de tempo. Cada cargo (de iniciante ou de área)
  só é adicionado se o recrutado ainda não o tiver — reaplicar `/recrutar`
  sobre alguém já verificado (que já tem Novato + Dragons Member, por
  exemplo) não repete nem falha, só pula o que já existe.
- **Remoção completa de `recruitmentCreditWindowHours` / `credit-window-hours`.**
  Consequência da decisão acima: como nada mais lê a janela de crédito, o
  campo foi removido de `GuildConfig` (`domain/types.ts`,
  `FirestoreDragonsStore.ts`, `NumberConfigKey`), do subcomando
  `/config set-number` e do espelho em
  `dragons-platform/shared/src/guild-config.ts` +
  `guild-config-api.ts` + `SettingsPage.tsx`. Documentos antigos no Firestore
  continuam com o campo gravado (não migrados), mas nenhum dos dois lados o
  lê mais — é inofensivo, só ocupa espaço.

Em aberto (proposta + confirmação):

1. **Recrutamentos pendentes na virada.** Proposta: não migrar. O handler
   `recruitment:approve:` continua registrado até drenarem; remover depois.
3. **Cargos aprovadores × Founder.** `approverRoleIds` é a nova fonte de
   verdade da ficha; `founderRoleId` continua governando `/verificar` e a fila
   de verificação de entrada. Unificar os dois é escopo separado.

---

## 9. Validação

- `npm run build` no `dragonsbot` (TypeScript `strict`) e `npm run check` na
  `dragons-platform` — obrigatórios antes de reportar qualquer PR concluído.
- `npm run deploy:commands` depois do PR 2 (comando novo).
- Sem suíte automatizada nos dois repos: o teste fim a fim depende de
  credenciais reais de Discord + Firestore. Checklist manual:
  configurar no painel (nos dois layouts) → `/recrutar` → **trocar o layout no
  painel com o wizard aberto** e confirmar que o wizard em andamento não muda e
  que o próximo `/recrutar` já sai no formato novo → percorrer as 3 etapas
  (incluindo `Voltar`, `Reiniciar`, `Cancelar` e expiração) → conferir a ficha
  no canal → aprovar com cargo autorizado e rejeitar outro rascunho → conferir
  cargos aplicados, 14 pontos creditados e rank sincronizado → `/pontos-dar`
  com e sem cargo autorizado.
