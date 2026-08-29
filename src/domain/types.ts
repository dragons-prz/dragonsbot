export const DEFAULT_RECRUITER_ROLE_ID = "1520118976087199754";
export const DEFAULT_FOUNDER_ROLE_ID = "1487882833761407007";
export const DEFAULT_MEMBER_ROLE_ID = "1488092923588247563";
export const DEFAULT_RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID = "1522080152094249140";
export const MEMBER_VERIFICATION_CHANNEL_ID = "1534723901421256784";
export const MEMBER_EXIT_CHANNEL_ID = "1534735482460831884";
export const DEFAULT_BLACKLIST_LOG_CHANNEL_ID = "1541992716496273478";
export const RECRUITMENT_POINTS = 8;

/**
 * Estas constantes deixaram de ser lidas direto pelo fluxo do bot: agora
 * sao apenas o VALOR PADRAO de campos do `GuildConfig`
 * (`memberVerificationChannelId`, `memberExitChannelId`, `recruitmentPoints`),
 * aplicados pela store quando o documento `guildConfigs/{guildId}` ainda nao
 * tem o campo. O painel (`dragons-platform`) edita esses campos; o bot le do
 * config.
 */

export interface HierarchyRole {
  name: string;
  roleId: string;
  points: number;
  order: number;
}

export const DEFAULT_HIERARCHY_ROLES: HierarchyRole[] = [
  { name: "Novato", roleId: "1488092923588247563", points: 0, order: 0 },
  { name: "Delusions", roleId: "1487888136598982838", points: 1, order: 1 },
  { name: "Hope", roleId: "1488087958249799850", points: 24, order: 2 },
  { name: "Lotus", roleId: "1488086603980214433", points: 56, order: 3 },
  { name: "Swag", roleId: "1488087908480057354", points: 96, order: 4 },
  { name: "Revenge", roleId: "1488086779532939284", points: 144, order: 5 },
  { name: "Mystic", roleId: "1488086653359882271", points: 200, order: 6 },
  { name: "Darkness", roleId: "1488086711278764213", points: 264, order: 7 },
  { name: "Death", roleId: "1487888101245325552", points: 336, order: 8 },
  { name: "Nightmare", roleId: "1487888057901518849", points: 416, order: 9 },
  { name: "Critic", roleId: "1487887943103283240", points: 504, order: 10 },
  { name: "Prince Of Chaos", roleId: "1487888006345003058", points: 600, order: 11 },
  { name: "Legend", roleId: "1488088043133865994", points: 704, order: 12 },
  { name: "Supreme", roleId: "1488088157625909269", points: 816, order: 13 },
  { name: "Insanity", roleId: "1488088110599503903", points: 936, order: 14 },
  { name: "Royal", roleId: "1487887769182142514", points: 1064, order: 15 },
  { name: "Imperial", roleId: "1487887706015928455", points: 1200, order: 16 },
  { name: "Destiny", roleId: "1487884344872927365", points: 1360, order: 17 },
  { name: "Eternal", roleId: "1488088203436097566", points: 1536, order: 18 },
  { name: "Immortal", roleId: "1487887891676926032", points: 1728, order: 19 },
  { name: "Angelical", roleId: "1487887828523417611", points: 1920, order: 20 },
  { name: "God", roleId: "1488086504202043502", points: 2160, order: 21 }
];

export type RoleConfigKey = "recruiter" | "founder" | "member";
export type ChannelConfigKey =
  | "approval"
  | "recruitment"
  | "blacklist"
  | "verification"
  | "exit";
export type NumberConfigKey = "points";
export type RecruitmentStatus = "pending" | "approved" | "rejected";
export type RecruitmentKind = "standard" | "credit";
export type MemberEntryStatus = "pending" | "verified_direct" | "recruitment_pending" | "recruited" | "credit_pending" | "credited" | "recruitment_rejected" | "left";
export type MemberActionJobType = "verify_member" | "approve_recruitment";
export type MemberActionJobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface GuildConfig {
  guildId: string;
  recruiterRoleId: string;
  founderRoleId: string;
  memberRoleId: string;
  approvalChannelId: string | null;
  recruitmentAnnouncementChannelId: string;
  blacklistLogChannelId: string;
  /** Canal onde o card de fila de verificacao de novos membros e postado. */
  memberVerificationChannelId: string;
  /** Canal onde o card de saida de membro e postado. */
  memberExitChannelId: string;
  /** Pontos creditados ao recrutador quando um recrutamento e aprovado. */
  recruitmentPoints: number;
  hierarchySeeded: boolean;
}

export interface Recruitment {
  id: number;
  guildId: string;
  recruitUserId: string;
  recruiterUserId: string;
  kind: RecruitmentKind;
  status: RecruitmentStatus;
  approvalMessageId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
  /**
   * Snapshots do que foi escolhido no wizard. Ficam gravados no
   * recrutamento para que editar a configuracao no painel NAO reescreva
   * recrutamentos ja criados nem mude uma ficha ja postada. Recrutamentos
   * legados (fluxo antigo de DM) tem `null`/vazio aqui.
   */
  starterRoleOptionId: string | null;
  starterRoleId: string | null;
  starterRoleLabel: string | null;
  areaOptionIds: string[];
  areaRoleIds: string[];
  areaLabels: string[];
  /** Pontos calculados no envio; `0` cai no fallback `GuildConfig.recruitmentPoints`. */
  points: number;
  sheetChannelId: string | null;
  sheetMessageId: string | null;
  /** Formato da ficha, congelado no envio. `null` nos recrutamentos legados. */
  sheetPresentation: RecruitmentSheetSnapshot | null;
  rejectedByUserId: string | null;
  rejectedAt: string | null;
}

export interface MemberEntry {
  guildId: string;
  userId: string;
  status: MemberEntryStatus;
  joinedAt: string;
  verificationChannelId: string | null;
  verificationMessageId: string | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  recruiterUserId: string | null;
  creditedAt: string | null;
  leftAt: string | null;
  recruitmentId: number | null;
  updatedAt: string;
}

export interface MemberActionJob {
  id: string;
  type: MemberActionJobType;
  status: MemberActionJobStatus;
  guildId: string;
  userId: string;
  requestedByUserId: string;
  recruitmentId: number | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  updatedAt: string;
}

export interface MemberProfile {
  guildId: string;
  userId: string;
  points: number;
  recruitments: number;
  rankName: string;
  rankRoleId: string;
  updatedAt: string;
}

export interface ApprovedRecruitmentResult {
  recruitment: Recruitment;
  member: MemberProfile;
  previousRankName: string;
  previousRankRoleId: string;
  rankChanged: boolean;
}

export interface MemberRankingEntry extends MemberProfile {
  position: number;
}

export interface RecruitmentApprovalMessage {
  recruitmentId: number;
  founderUserId: string;
  channelId: string;
  messageId: string;
}

export interface MemberProfileResult {
  profile: MemberProfile;
  rank: HierarchyRole;
}

export interface CreateRecruitmentInput {
  guildId: string;
  recruitUserId: string;
  recruiterUserId: string;
  kind?: RecruitmentKind;
  starterRoleOptionId?: string | null;
  starterRoleId?: string | null;
  starterRoleLabel?: string | null;
  areaOptionIds?: string[];
  areaRoleIds?: string[];
  areaLabels?: string[];
  points?: number;
  sheetPresentation?: RecruitmentSheetSnapshot | null;
}

export interface CreateMemberEntryInput {
  guildId: string;
  userId: string;
  joinedAt: string;
}

export interface EnqueueMemberActionJobInput {
  type: MemberActionJobType;
  guildId: string;
  userId: string;
  requestedByUserId: string;
  recruitmentId?: number | null;
}

export interface EnqueueMemberActionJobResult {
  job: MemberActionJob;
  created: boolean;
}

export interface BlacklistEntry {
  guildId: string;
  userId: string;
  reason: string;
  addedByUserId: string;
  addedAt: string;
}

export type PanelButtonStyle = "Primary" | "Secondary" | "Success" | "Danger";

/**
 * Tipo do painel: `buttons` (linhas de botoes, o formato historico) ou
 * `select` (um unico dropdown no lugar dos botoes). Documentos antigos nao
 * tem o campo — o mapeamento da store trata ausencia como `"buttons"`.
 */
export type PanelKind = "buttons" | "select";

/**
 * Formato da mensagem do painel:
 * - `embed`: um `EmbedBuilder` (formato historico) — imagem sempre embaixo,
 *   `title` nao renderiza emoji customizado do servidor.
 * - `container`: Components V2 (`ContainerBuilder`) — a imagem vira um
 *   banner no topo e o titulo/descricao viram texto markdown.
 *
 * Ausente no documento = `"embed"`.
 */
export type PanelLayout = "embed" | "container";

/**
 * Acao disparada quando um botao/opcao do painel e clicado.
 *
 * - `reply`: responde com um embed efemero (comportamento historico do
 *   painel — os campos `response`/`responseImageUrl`/`responseColor`).
 * - `run`: dispara uma acao registrada no bot (`PANEL_ACTION_REGISTRY`),
 *   identificada por `actionId`, com parametros livres.
 */
export interface PanelReplyAction {
  type: "reply";
  response: string;
  responseImageUrl: string | null;
  responseColor: string | null;
}

export interface PanelRunAction {
  type: "run";
  actionId: string;
  params: Record<string, string>;
}

export type PanelActionConfig = PanelReplyAction | PanelRunAction;

/** Ids de acao `run` reconhecidos pelo bot — espelho do `PANEL_ACTIONS` da dragons-platform. */
export const PANEL_ACTION_IDS = ["support-ticket"] as const;
export type PanelActionId = (typeof PANEL_ACTION_IDS)[number];

export interface PanelButtonConfig {
  id: string;
  label: string;
  emoji: string | null;
  style: PanelButtonStyle;
  /**
   * Campos legados mantidos para compatibilidade: quando o documento nao
   * tem `action`, a store monta `{ type: "reply", ... }` a partir deles.
   */
  response: string;
  responseImageUrl: string | null;
  responseColor: string | null;
  action: PanelActionConfig;
  order: number;
}

export interface PanelSelectOption {
  id: string;
  label: string;
  description: string | null;
  emoji: string | null;
  action: PanelActionConfig;
  order: number;
}

export interface PanelSelectConfig {
  placeholder: string;
  options: PanelSelectOption[];
}

export interface PanelConfig {
  id: string;
  guildId: string;
  title: string;
  description: string;
  imageUrl: string | null;
  color: string | null;
  kind: PanelKind;
  layout: PanelLayout;
  buttons: PanelButtonConfig[];
  /** Preenchido apenas quando `kind === "select"`; `null` caso contrario. */
  select: PanelSelectConfig | null;
  createdAt: string;
  updatedAt: string;
  publishedChannelId?: string | null;
  publishedMessageId?: string | null;
}

export type SupportCategoryCloseAction = "archive-remove";

/**
 * Configuracao de uma categoria de ticket de suporte. Escrita SO pela
 * dragons-platform (colecao `supportCategories/{guildId}_{id}`); o bot so
 * le. Referenciada por uma acao `run` de `actionId: "support-ticket"` via
 * `params.category`.
 */
export interface SupportCategoryConfig {
  id: string;
  guildId: string;
  name: string;
  parentChannelId: string;
  supportRoleIds: string[];
  viewerRoleIds: string[];
  threadNameTemplate: string;
  openMessage: string;
  claimMessage: string;
  closeMessage: string;
  closeAction: SupportCategoryCloseAction;
  createdAt: string;
  updatedAt: string;
}

export type TicketStatus = "open" | "claimed" | "closed";

/**
 * Registro de um ticket de suporte aberto. Escrito SO pelo bot (colecao
 * `tickets/{ticketId}`); a dragons-platform le para o dashboard (fase 3).
 */
export interface TicketRecord {
  id: string;
  guildId: string;
  panelId: string;
  categoryId: string;
  openerUserId: string;
  parentChannelId: string;
  threadId: string;
  pingMessageId: string;
  status: TicketStatus;
  claimedByUserId: string | null;
  claimedAt: string | null;
  closedByUserId: string | null;
  closedAt: string | null;
  feedbackRating: number | null;
  feedbackComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTicketInput {
  /** Id do documento. Quando omitido, a store gera um. O fluxo de abertura
   * passa um id gerado antes para usar um prefixo dele no nome do topico. */
  id?: string;
  guildId: string;
  panelId: string;
  categoryId: string;
  openerUserId: string;
  parentChannelId: string;
  threadId: string;
  pingMessageId: string;
}

export type PanelJobStatus = "pending" | "processing" | "completed" | "failed";

export interface PanelJob {
  id: string;
  guildId: string;
  panelId: string;
  channelId: string;
  requestedByUserId: string;
  status: PanelJobStatus;
  messageId: string | null;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Recrutamento em 3 etapas
 *
 * `RecruitmentFlowConfig` e os tipos que ela compoe sao ESPELHO de
 * `dragons-platform/shared/src/recruitment-config.ts`. O documento
 * `recruitmentConfigs/{guildId}` e escrito SO pela plataforma; o bot so le.
 * Mudanca de forma = PR coordenado nos dois repos.
 *
 * Spec: `docs/specs/2026-08-29-recrutamento-multi-etapas.md`.
 * ------------------------------------------------------------------ */

/**
 * Uma mensagem do fluxo, no mesmo modelo das mensagens de painel:
 * `embed` (classico) ou `container` (Components V2). `title` e `description`
 * sao templates — `{chave}` e trocado por `renderTemplate`.
 */
export interface RecruitmentMessageConfig {
  layout: PanelLayout;
  title: string;
  description: string;
  imageUrl: string | null;
  color: string | null;
}

/**
 * Um botao do fluxo. `label` vazio e valido quando ha `emoji` (botao so com
 * icone). `emoji` customizado precisa ser `<:nome:id>` — o Discord nao
 * resolve `:shortcode:`.
 */
export interface RecruitmentButtonConfig {
  label: string;
  emoji: string | null;
  style: PanelButtonStyle;
}

export interface RecruitmentSelectConfig {
  placeholder: string;
}

export interface RecruitmentStarterRoleOption {
  id: string;
  label: string;
  description: string | null;
  emoji: string | null;
  roleId: string;
  order: number;
}

export interface RecruitmentAreaOption {
  id: string;
  label: string;
  description: string | null;
  emoji: string | null;
  roleIds: string[];
  /** Pontos creditados ao RECRUTADOR por esta area. */
  points: number;
  order: number;
}

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

export interface RecruitmentOutcomeConfig {
  submitted: RecruitmentMessageConfig;
  cancelled: RecruitmentMessageConfig;
  expired: RecruitmentMessageConfig;
}

export type RecruitmentAvatarPlacement = "thumbnail" | "image" | "none";

export interface RecruitmentSheetConfig {
  channelId: string | null;
  message: RecruitmentMessageConfig;
  approveButton: RecruitmentButtonConfig;
  rejectButton: RecruitmentButtonConfig;
  queued: RecruitmentMessageConfig;
  approved: RecruitmentMessageConfig;
  rejected: RecruitmentMessageConfig;
  approvedButton: RecruitmentButtonConfig;
  rejectedButton: RecruitmentButtonConfig;
  avatarPlacement: RecruitmentAvatarPlacement;
  mentionApprovers: boolean;
}

export type RecruitmentPointsMode = "sum" | "highest";

export interface RecruitmentFlowConfig {
  guildId: string;
  starterRoles: RecruitmentStarterRoleOption[];
  areas: RecruitmentAreaOption[];
  minAreas: number;
  maxAreas: number;
  stepOne: RecruitmentStepOneConfig;
  stepTwo: RecruitmentStepTwoConfig;
  stepThree: RecruitmentStepThreeConfig;
  outcome: RecruitmentOutcomeConfig;
  sheet: RecruitmentSheetConfig;
  approverRoleIds: string[];
  pointsGrantRoleIds: string[];
  pointsMode: RecruitmentPointsMode;
  minManualPoints: number;
  maxManualPoints: number;
  draftTtlMinutes: number;
  rolePendingText: string;
  areasPendingText: string;
  notRecruiterMessage: string;
  notApproverMessage: string;
  notDraftOwnerMessage: string;
  notConfiguredMessage: string;
  createdAt: string;
  updatedAt: string;
}

function recruitmentMessage(
  title: string,
  description: string,
  color: string | null = "#5865F2"
): RecruitmentMessageConfig {
  return { layout: "container", title, description, imageUrl: null, color };
}

function recruitmentButton(
  label: string,
  style: PanelButtonStyle,
  emoji: string | null = null
): RecruitmentButtonConfig {
  return { label, emoji, style };
}

const WIZARD_FIELDS = [
  "**Recrutado:** {recruited}",
  "**Cargo:** `{role}`",
  "**Areas:** `{areas}`"
].join("\n");

const SHEET_FIELDS = [
  "**Recrutador:** {recruiter}",
  "**Recrutado:** {recruited} (`{recruitedId}`)",
  "**Cargo:** `{role}`",
  "**Areas:** `{areas}`",
  "**Conta criada:** {createdAt}"
].join("\n");

/**
 * Default aplicado quando `recruitmentConfigs/{guildId}` nao existe ou tem
 * campo ausente — os MESMOS valores que a dragons-platform aplica do outro
 * lado. Listas vazias e `sheet.channelId` nulo significam "ainda nao
 * configurado no painel": o comando responde `notConfiguredMessage`.
 */
export const DEFAULT_RECRUITMENT_FLOW_CONFIG: Omit<
  RecruitmentFlowConfig,
  "guildId" | "createdAt" | "updatedAt"
> = {
  starterRoles: [],
  areas: [],
  minAreas: 1,
  maxAreas: 2,
  stepOne: {
    message: recruitmentMessage(
      "Recrutamento - etapa {step}/{total}",
      `${WIZARD_FIELDS}\n\n*Selecione o cargo de iniciante*`
    ),
    select: { placeholder: "Selecione o cargo de iniciante" },
    cancelButton: recruitmentButton("Cancelar", "Danger")
  },
  stepTwo: {
    message: recruitmentMessage(
      "Recrutamento - etapa {step}/{total}",
      `${WIZARD_FIELDS}\n\n*Selecione ate {max} areas*`
    ),
    select: { placeholder: "Selecione as areas" },
    backButton: recruitmentButton("Voltar", "Secondary"),
    cancelButton: recruitmentButton("Cancelar", "Danger")
  },
  stepThree: {
    message: recruitmentMessage(
      "Confirmar recrutamento",
      `${WIZARD_FIELDS}\n\n*Confirme para aplicar os cargos e gerar a ficha*`
    ),
    confirmButton: recruitmentButton("Confirmar", "Success"),
    restartButton: recruitmentButton("Reiniciar", "Secondary"),
    cancelButton: recruitmentButton("Cancelar", "Danger")
  },
  outcome: {
    submitted: recruitmentMessage(
      "Recrutamento enviado",
      `${WIZARD_FIELDS}\n\nA ficha foi enviada para aprovacao da gerencia.`,
      "#F08C00"
    ),
    cancelled: recruitmentMessage(
      "Recrutamento cancelado",
      "O recrutamento de {recruited} foi cancelado por {recruiter}.",
      "#868E96"
    ),
    expired: recruitmentMessage(
      "Recrutamento expirado",
      "O recrutamento de {recruited} expirou sem ser concluido. Rode `/recrutar` de novo.",
      "#868E96"
    )
  },
  sheet: {
    channelId: null,
    message: recruitmentMessage("Ficha de recrutamento", SHEET_FIELDS),
    approveButton: recruitmentButton("Confirmar", "Success"),
    rejectButton: recruitmentButton("Rejeitar", "Danger"),
    queued: recruitmentMessage(
      "Ficha em processamento",
      `${SHEET_FIELDS}\n\nConfirmada por {approver}. Aplicando os cargos...`,
      "#F08C00"
    ),
    approved: recruitmentMessage(
      "Recrutamento aprovado",
      `${SHEET_FIELDS}\n\nAprovado por {approver}. O recrutador recebeu **{points}** pontos.`,
      "#2F9E44"
    ),
    rejected: recruitmentMessage(
      "Recrutamento rejeitado",
      `${SHEET_FIELDS}\n\nRejeitado por {approver}.`,
      "#C92A2A"
    ),
    approvedButton: recruitmentButton("Aprovado", "Success"),
    rejectedButton: recruitmentButton("Rejeitado", "Danger"),
    avatarPlacement: "thumbnail",
    mentionApprovers: true
  },
  approverRoleIds: [],
  pointsGrantRoleIds: [],
  pointsMode: "sum",
  minManualPoints: -100,
  maxManualPoints: 100,
  draftTtlMinutes: 15,
  rolePendingText: "aguardando selecao",
  areasPendingText: "aguardando",
  notRecruiterMessage: "Voce nao possui o cargo de recrutamento.",
  notApproverMessage: "Voce nao tem permissao para essa acao.",
  notDraftOwnerMessage: "Apenas quem iniciou este recrutamento pode usar estes botoes.",
  notConfiguredMessage:
    "O fluxo de recrutamento ainda nao foi configurado no painel (cargos de iniciante, areas e canal da ficha)."
};

/** Soma (default) ou maior valor dos pontos das areas escolhidas. */
export function calculateRecruitmentPoints(
  areas: readonly RecruitmentAreaOption[],
  mode: RecruitmentPointsMode
): number {
  if (areas.length === 0) {
    return 0;
  }
  const points = areas.map((area) => area.points);
  return mode === "highest" ? Math.max(...points) : points.reduce((total, value) => total + value, 0);
}

/* ------------------------------------------------------------------ *
 * Rascunho do wizard e snapshot de apresentacao
 *
 * Escrita EXCLUSIVA do bot (`recruitmentDrafts/{draftId}`).
 * ------------------------------------------------------------------ */

/**
 * Tudo que o wizard precisa para se desenhar, congelado no `/recrutar`.
 *
 * E o que garante que mudar a configuracao no painel valha so para
 * recrutamentos NOVOS: um wizard aberto termina no formato em que comecou,
 * e nenhuma mensagem precisa ser reposta (o Discord nao deixa editar uma
 * mensagem alternando entre embed e Components V2).
 */
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

export type RecruitmentDraftStatus =
  | "selecting_role"
  | "selecting_areas"
  | "confirming"
  | "submitted"
  | "cancelled"
  | "expired";

export interface RecruitmentDraft {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  recruiterUserId: string;
  recruitUserId: string;
  kind: RecruitmentKind;
  status: RecruitmentDraftStatus;
  starterRoleId: string | null;
  areaIds: string[];
  presentation: RecruitmentPresentationSnapshot;
  recruitmentId: number | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CreateRecruitmentDraftInput {
  guildId: string;
  channelId: string;
  recruiterUserId: string;
  recruitUserId: string;
  kind: RecruitmentKind;
  presentation: RecruitmentPresentationSnapshot;
  ttlMinutes: number;
}

export interface UpdateRecruitmentDraftInput {
  starterRoleId?: string | null;
  areaIds?: string[];
  status: RecruitmentDraftStatus;
}
