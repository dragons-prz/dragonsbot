export const DEFAULT_RECRUITER_ROLE_ID = "1520118976087199754";
export const DEFAULT_FOUNDER_ROLE_ID = "1487882833761407007";
export const DEFAULT_MEMBER_ROLE_ID = "1488092923588247563";
export const DEFAULT_RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID = "1522080152094249140";
export const MEMBER_VERIFICATION_CHANNEL_ID = "1534723901421256784";
export const MEMBER_EXIT_CHANNEL_ID = "1534735482460831884";
export const DEFAULT_BLACKLIST_LOG_CHANNEL_ID = "1541992716496273478";
export const RECRUITMENT_POINTS = 8;
export const RECRUITMENT_CREDIT_WINDOW_HOURS = 24;

/**
 * Estas constantes deixaram de ser lidas direto pelo fluxo do bot: agora
 * sao apenas o VALOR PADRAO de campos do `GuildConfig`
 * (`memberVerificationChannelId`, `memberExitChannelId`, `recruitmentPoints`,
 * `recruitmentCreditWindowHours`), aplicados pela store quando o documento
 * `guildConfigs/{guildId}` ainda nao tem o campo. O painel
 * (`dragons-platform`) edita esses campos; o bot le do config.
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
export type NumberConfigKey = "points" | "credit-window-hours";
export type RecruitmentStatus = "pending" | "approved";
export type RecruitmentKind = "standard" | "credit";
export type MemberEntryStatus = "pending" | "verified_direct" | "recruitment_pending" | "recruited" | "credit_pending" | "credited" | "left";
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
  /** Janela (horas) apos a entrada em que ainda cabe pedir credito de recrutamento. */
  recruitmentCreditWindowHours: number;
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
