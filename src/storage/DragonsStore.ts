import {
  BlacklistEntry,
  ChannelConfigKey,
  CreateMemberEntryInput,
  CreateRecruitmentInput,
  CreateTicketInput,
  EnqueueMemberActionJobInput,
  EnqueueMemberActionJobResult,
  GuildConfig,
  ApprovedRecruitmentResult,
  HierarchyRole,
  MemberActionJob,
  MemberEntry,
  MemberProfile,
  MemberProfileResult,
  MemberRankingEntry,
  NumberConfigKey,
  PanelButtonConfig,
  PanelConfig,
  PanelJob,
  Recruitment,
  RecruitmentApprovalMessage,
  RoleConfigKey,
  SupportCategoryConfig,
  TicketRecord
} from "../domain/types";

export interface DragonsStore {
  init(): Promise<void>;
  close(): Promise<void>;

  getGuildConfig(guildId: string): Promise<GuildConfig>;
  setRoleConfig(guildId: string, key: RoleConfigKey, roleId: string): Promise<GuildConfig>;
  setChannelConfig(guildId: string, key: ChannelConfigKey, channelId: string): Promise<GuildConfig>;
  setNumberConfig(guildId: string, key: NumberConfigKey, value: number): Promise<GuildConfig>;
  seedDefaultHierarchyRoles(guildId: string): Promise<HierarchyRole[]>;
  getHierarchyRoles(guildId: string): Promise<HierarchyRole[]>;

  createOrUpdateMemberEntry(input: CreateMemberEntryInput): Promise<MemberEntry>;
  getMemberEntry(guildId: string, userId: string): Promise<MemberEntry | null>;
  setMemberEntryVerificationMessage(guildId: string, userId: string, channelId: string, messageId: string): Promise<MemberEntry | null>;
  markMemberEntryVerifiedDirect(guildId: string, userId: string, verifiedByUserId: string): Promise<MemberEntry | null>;
  markMemberEntryRecruitmentPending(guildId: string, userId: string, recruiterUserId: string, recruitmentId: number): Promise<MemberEntry | null>;
  markMemberEntryRecruited(guildId: string, userId: string, recruiterUserId: string, approvedByUserId: string, recruitmentId: number): Promise<MemberEntry | null>;
  markMemberEntryCreditPending(guildId: string, userId: string, recruiterUserId: string, recruitmentId: number): Promise<MemberEntry | null>;
  markMemberEntryCredited(guildId: string, userId: string, recruiterUserId: string, approvedByUserId: string, recruitmentId: number): Promise<MemberEntry | null>;
  markMemberEntryLeft(guildId: string, userId: string): Promise<MemberEntry | null>;

  enqueueMemberActionJob(input: EnqueueMemberActionJobInput): Promise<EnqueueMemberActionJobResult>;
  claimNextPendingMemberActionJob(): Promise<MemberActionJob | null>;
  completeMemberActionJob(id: string): Promise<void>;
  failMemberActionJob(id: string, error: string): Promise<void>;
  cancelMemberActionJob(id: string, reason: string): Promise<void>;
  resetStaleProcessingMemberActionJobs(staleAfterMs: number): Promise<number>;
  /**
   * Observa a fila `memberActionJobs` e chama `onPending` sempre que existir (ou
   * passar a existir) algum job com status `pending`. Retorna uma funcao para
   * cancelar a observacao. Substitui o polling fixo do worker: o Firestore so e
   * consultado quando ha mudanca de fato na fila.
   */
  watchPendingMemberActionJobs(onPending: () => void): () => void;

  createRecruitment(input: CreateRecruitmentInput): Promise<Recruitment>;
  getRecruitment(id: number): Promise<Recruitment | null>;
  findPendingRecruitmentByUser(guildId: string, recruitUserId: string): Promise<Recruitment | null>;
  setRecruitmentApprovalMessage(id: number, messageId: string): Promise<void>;
  addRecruitmentApprovalMessage(input: RecruitmentApprovalMessage): Promise<void>;
  getRecruitmentApprovalMessages(recruitmentId: number): Promise<RecruitmentApprovalMessage[]>;
  deletePendingRecruitment(id: number): Promise<void>;
  approveRecruitment(id: number, approvedByUserId: string): Promise<Recruitment | null>;
  approveRecruitmentAndAddMemberPoints(id: number, approvedByUserId: string, points: number, reason: string): Promise<ApprovedRecruitmentResult | null>;

  addMemberPoints(guildId: string, userId: string, points: number, reason: string): Promise<MemberProfile>;
  ensureMemberProfile(guildId: string, userId: string): Promise<MemberProfileResult>;
  getMemberProfile(guildId: string, userId: string): Promise<MemberProfileResult>;
  getMemberRanking(guildId: string, limit: number): Promise<MemberRankingEntry[]>;

  createPanel(guildId: string, id: string, title: string, description: string): Promise<PanelConfig>;
  getPanel(guildId: string, id: string): Promise<PanelConfig | null>;
  listPanels(guildId: string): Promise<PanelConfig[]>;
  setPanelImage(guildId: string, id: string, imageUrl: string): Promise<PanelConfig>;
  setPanelColor(guildId: string, id: string, color: string | null): Promise<PanelConfig>;
  addPanelButton(guildId: string, id: string, button: Omit<PanelButtonConfig, "order">): Promise<PanelConfig>;
  removePanelButton(guildId: string, id: string, buttonId: string): Promise<PanelConfig>;
  deletePanel(guildId: string, id: string): Promise<void>;
  setPanelPublishedMessage(guildId: string, id: string, channelId: string, messageId: string): Promise<void>;

  claimNextPendingPanelJob(): Promise<PanelJob | null>;
  completePanelJob(id: string, messageId: string): Promise<void>;
  failPanelJob(id: string, error: string): Promise<void>;
  resetStalePanelJobs(staleAfterMs: number): Promise<number>;
  /**
   * Observa a fila `panelJobs` e chama `onPending` sempre que existir (ou passar
   * a existir) algum job com status `pending`. Retorna uma funcao para cancelar
   * a observacao. Substitui o polling fixo do worker: o Firestore so e
   * consultado quando ha mudanca de fato na fila.
   */
  watchPendingPanelJobs(onPending: () => void): () => void;

  /**
   * Categorias de ticket de suporte (`supportCategories/{guildId}_{id}`).
   * Escritas SO pela dragons-platform; o bot apenas le.
   */
  getSupportCategory(guildId: string, id: string): Promise<SupportCategoryConfig | null>;
  listSupportCategories(guildId: string): Promise<SupportCategoryConfig[]>;

  /**
   * Trava de "1 ticket aberto por usuario": cria `openTicketKeys/{guildId}_{openerUserId}`
   * de forma atomica. Retorna `false` se ja existe (o usuario ja tem ticket aberto).
   */
  claimTicketSlot(guildId: string, openerUserId: string): Promise<boolean>;
  releaseTicketSlot(guildId: string, openerUserId: string): Promise<void>;
  createTicket(input: CreateTicketInput): Promise<TicketRecord>;
  getTicket(ticketId: string): Promise<TicketRecord | null>;
  /** Transacao: so `open` -> `claimed`. Retorna o ticket resultante, ou `null` se ja nao estava `open`. */
  claimTicket(ticketId: string, claimerUserId: string): Promise<TicketRecord | null>;
  /** Transacao: `open`/`claimed` -> `closed`. Retorna o ticket resultante, ou `null` se ja estava `closed` ou nao existe. */
  closeTicket(ticketId: string, closerUserId: string): Promise<TicketRecord | null>;

  addToBlacklist(guildId: string, userId: string, reason: string, addedByUserId: string): Promise<BlacklistEntry>;
  removeFromBlacklist(guildId: string, userId: string): Promise<BlacklistEntry | null>;
  getBlacklistEntry(guildId: string, userId: string): Promise<BlacklistEntry | null>;
  listBlacklist(guildId: string): Promise<BlacklistEntry[]>;
}
