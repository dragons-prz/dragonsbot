import { cert, getApps, initializeApp, ServiceAccount } from "firebase-admin/app";
import { Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { AppEnv } from "../../config/env";
import { logger } from "../../utils/logger";
import {
  ApprovedRecruitmentResult,
  BlacklistEntry,
  ChannelConfigKey,
  CreateMemberEntryInput,
  CreateRecruitmentInput,
  EnqueueMemberActionJobInput,
  EnqueueMemberActionJobResult,
  DEFAULT_BLACKLIST_LOG_CHANNEL_ID,
  DEFAULT_HIERARCHY_ROLES,
  DEFAULT_FOUNDER_ROLE_ID,
  DEFAULT_MEMBER_ROLE_ID,
  DEFAULT_RECRUITER_ROLE_ID,
  DEFAULT_RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID,
  GuildConfig,
  HierarchyRole,
  MEMBER_EXIT_CHANNEL_ID,
  MEMBER_VERIFICATION_CHANNEL_ID,
  NumberConfigKey,
  RECRUITMENT_POINTS,
  MemberActionJob,
  MemberActionJobStatus,
  MemberActionJobType,
  MemberEntry,
  MemberEntryStatus,
  MemberProfile,
  MemberProfileResult,
  MemberRankingEntry,
  PanelActionConfig,
  PanelBlock,
  PanelButtonConfig,
  PanelButtonStyle,
  PanelConfig,
  PanelJob,
  PanelJobStatus,
  PanelLayout,
  PanelSelectConfig,
  panelBlocksFromLegacy,
  Recruitment,
  RecruitmentKind,
  RecruitmentApprovalMessage,
  RecruitmentDraft,
  RecruitmentDraftStatus,
  RecruitmentFlowConfig,
  RecruitmentPresentationSnapshot,
  RecruitmentSheetSnapshot,
  RecruitmentStatus,
  CreateRecruitmentDraftInput,
  UpdateRecruitmentDraftInput,
  DEFAULT_RECRUITMENT_FLOW_CONFIG,
  RoleConfigKey,
  CreateTicketInput,
  SupportCategoryCloseAction,
  SupportCategoryConfig,
  TicketKind,
  TicketRecord,
  TicketStatus
} from "../../domain/types";
import { DragonsStore } from "../DragonsStore";

/** Estados de rascunho em que ainda cabe editar/cancelar. */
const EDITABLE_DRAFT_STATUSES: RecruitmentDraftStatus[] = [
  "selecting_role",
  "selecting_areas",
  "confirming"
];

function isEditableDraftStatus(status: RecruitmentDraftStatus): boolean {
  return EDITABLE_DRAFT_STATUSES.includes(status);
}

interface GuildConfigDocument {
  recruiterRoleId: string;
  founderRoleId: string;
  memberRoleId: string;
  approvalChannelId: string | null;
  recruitmentAnnouncementChannelId?: string;
  blacklistLogChannelId?: string;
  memberVerificationChannelId?: string;
  memberExitChannelId?: string;
  recruitmentPoints?: number;
  hierarchySeeded?: boolean;
}

interface RecruitmentDocument {
  id: number;
  guildId: string;
  recruitUserId: string;
  recruiterUserId: string;
  kind?: RecruitmentKind;
  status: RecruitmentStatus;
  approvalMessageId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
  /** Campos do fluxo de 3 etapas; ausentes nos recrutamentos legados. */
  starterRoleOptionId?: string | null;
  starterRoleId?: string | null;
  starterRoleLabel?: string | null;
  areaOptionIds?: string[];
  areaRoleIds?: string[];
  areaLabels?: string[];
  points?: number;
  ticketId?: string | null;
  ticketThreadId?: string | null;
  sheetChannelId?: string | null;
  sheetMessageId?: string | null;
  sheetPresentation?: RecruitmentSheetSnapshot | null;
  rejectedByUserId?: string | null;
  rejectedAt?: string | null;
}

interface RecruitmentDraftDocument {
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

interface MemberEntryDocument {
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
  leftAt?: string | null;
  recruitmentId: number | null;
  updatedAt: string;
}

interface MemberActionJobDocument {
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

interface MemberDocument {
  guildId: string;
  userId: string;
  points: number;
  recruitments: number;
  rankName: string;
  rankRoleId: string;
  updatedAt: string;
}

interface ApprovalMessageDocument {
  founderUserId: string;
  channelId: string;
  messageId: string;
}

interface HierarchyRoleDocument {
  guildId: string;
  name: string;
  roleId: string;
  points: number;
  order: number;
}

interface PanelButtonDocument {
  id: string;
  label: string;
  emoji: string | null;
  style: PanelButtonStyle;
  response: string;
  responseImageUrl?: string | null;
  responseColor?: string | null;
  action?: PanelActionConfig;
  order: number;
}

interface PanelSelectOptionDocument {
  id: string;
  label: string;
  description?: string | null;
  emoji: string | null;
  action?: PanelActionConfig;
  order: number;
}

interface PanelSelectDocument {
  placeholder: string;
  options: PanelSelectOptionDocument[];
}

interface PanelDocument {
  id: string;
  guildId: string;
  color: string | null;
  /** Formato novo: lista de blocos (Components V2). Ausente nos docs antigos. */
  blocks?: PanelBlock[];
  createdAt: string;
  updatedAt: string;
  publishedChannelId?: string | null;
  publishedMessageId?: string | null;
  /** Campos legados — so a migracao de leitura (`mapPanel`) os usa. */
  title?: string;
  description?: string;
  imageUrl?: string | null;
  kind?: string;
  layout?: PanelLayout;
  buttons?: PanelButtonDocument[];
  select?: PanelSelectDocument | null;
}

interface SupportCategoryDocument {
  id: string;
  guildId: string;
  name: string;
  parentChannelId: string;
  supportRoleIds?: string[];
  viewerRoleIds?: string[];
  threadNameTemplate: string;
  openMessage: string;
  claimMessage: string;
  closeMessage: string;
  closeAction?: SupportCategoryCloseAction;
  createdAt: string;
  updatedAt: string;
}

interface TicketDocument {
  id: string;
  guildId: string;
  panelId: string;
  categoryId: string;
  openerUserId: string;
  parentChannelId: string;
  threadId: string;
  pingMessageId: string;
  status: TicketStatus;
  kind?: TicketKind;
  declaredRecruiterUserId?: string | null;
  escalateAt?: string | null;
  escalatedAt?: string | null;
  recruitmentId?: number | null;
  claimedByUserId: string | null;
  claimedAt: string | null;
  closedByUserId: string | null;
  closedAt: string | null;
  feedbackRating?: number | null;
  feedbackComment?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PanelJobDocument {
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

interface BlacklistDocument {
  guildId: string;
  userId: string;
  reason: string;
  addedByUserId: string;
  addedAt: string;
}

export class FirestoreDragonsStore implements DragonsStore {
  private db: Firestore;

  constructor(private readonly env: AppEnv) {
    if (!getApps().length) {
      initializeApp({
        credential: cert(this.loadServiceAccount())
      });
    }

    this.db = getFirestore();
  }

  async init(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }

  async getGuildConfig(guildId: string): Promise<GuildConfig> {
    const ref = this.guildConfigRef(guildId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      const defaults = this.defaultGuildConfigDocument();
      await ref.set(defaults);
      await this.seedDefaultHierarchyRoles(guildId);
      return this.mapGuildConfig(guildId, defaults);
    }

    const data = snapshot.data() as GuildConfigDocument;
    if (!data.recruitmentAnnouncementChannelId) {
      data.recruitmentAnnouncementChannelId = DEFAULT_RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID;
      await ref.update({ recruitmentAnnouncementChannelId: data.recruitmentAnnouncementChannelId });
    }

    if (!data.blacklistLogChannelId) {
      data.blacklistLogChannelId = DEFAULT_BLACKLIST_LOG_CHANNEL_ID;
      await ref.update({ blacklistLogChannelId: data.blacklistLogChannelId });
    }

    if (!data.memberVerificationChannelId) {
      data.memberVerificationChannelId = MEMBER_VERIFICATION_CHANNEL_ID;
      await ref.update({ memberVerificationChannelId: data.memberVerificationChannelId });
    }

    if (!data.memberExitChannelId) {
      data.memberExitChannelId = MEMBER_EXIT_CHANNEL_ID;
      await ref.update({ memberExitChannelId: data.memberExitChannelId });
    }

    if (data.recruitmentPoints === undefined) {
      data.recruitmentPoints = RECRUITMENT_POINTS;
      await ref.update({ recruitmentPoints: data.recruitmentPoints });
    }

    if (!data.hierarchySeeded) {
      await this.seedDefaultHierarchyRoles(guildId);
      await ref.update({ hierarchySeeded: true });
      data.hierarchySeeded = true;
    }

    return this.mapGuildConfig(guildId, data);
  }

  async setRoleConfig(guildId: string, key: RoleConfigKey, roleId: string): Promise<GuildConfig> {
    await this.ensureGuildConfig(guildId);
    const fieldByKey: Record<RoleConfigKey, keyof GuildConfigDocument> = {
      recruiter: "recruiterRoleId",
      founder: "founderRoleId",
      member: "memberRoleId"
    };

    await this.guildConfigRef(guildId).update({ [fieldByKey[key]]: roleId });
    return this.getGuildConfig(guildId);
  }

  async setChannelConfig(guildId: string, key: ChannelConfigKey, channelId: string): Promise<GuildConfig> {
    const fieldByKey: Record<ChannelConfigKey, keyof GuildConfigDocument> = {
      approval: "approvalChannelId",
      recruitment: "recruitmentAnnouncementChannelId",
      blacklist: "blacklistLogChannelId",
      verification: "memberVerificationChannelId",
      exit: "memberExitChannelId"
    };

    await this.ensureGuildConfig(guildId);
    await this.guildConfigRef(guildId).update({ [fieldByKey[key]]: channelId });
    return this.getGuildConfig(guildId);
  }

  async setNumberConfig(guildId: string, key: NumberConfigKey, value: number): Promise<GuildConfig> {
    const fieldByKey: Record<NumberConfigKey, keyof GuildConfigDocument> = {
      points: "recruitmentPoints"
    };

    await this.ensureGuildConfig(guildId);
    await this.guildConfigRef(guildId).update({ [fieldByKey[key]]: value });
    return this.getGuildConfig(guildId);
  }

  async seedDefaultHierarchyRoles(guildId: string): Promise<HierarchyRole[]> {
    const batch = this.db.batch();
    for (const role of DEFAULT_HIERARCHY_ROLES) {
      batch.set(this.hierarchyRoleRef(guildId, role.order), { guildId, ...role }, { merge: true });
    }
    batch.set(this.guildConfigRef(guildId), { hierarchySeeded: true }, { merge: true });
    await batch.commit();
    logger.info("hierarchy.seeded", {
      guildId,
      roles: DEFAULT_HIERARCHY_ROLES.length
    });
    return this.getHierarchyRoles(guildId);
  }

  async getHierarchyRoles(guildId: string): Promise<HierarchyRole[]> {
    const snapshot = await this.db
      .collection("hierarchyRoles")
      .where("guildId", "==", guildId)
      .get();
    const roles = snapshot.docs
      .map((doc) => this.mapHierarchyRole(doc.data() as HierarchyRoleDocument))
      .sort((a, b) => a.points - b.points || a.order - b.order);

    if (roles.length === 0) {
      return this.seedDefaultHierarchyRoles(guildId);
    }

    return roles;
  }

  async createOrUpdateMemberEntry(input: CreateMemberEntryInput): Promise<MemberEntry> {
    const now = new Date().toISOString();
    const ref = this.memberEntryRef(input.guildId, input.userId);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      const data = snapshot.data() as MemberEntryDocument;
      const updated: MemberEntryDocument = {
        ...data,
        status: "pending",
        joinedAt: input.joinedAt,
        verificationChannelId: null,
        verificationMessageId: null,
        verifiedByUserId: null,
        verifiedAt: null,
        recruiterUserId: null,
        creditedAt: null,
        leftAt: null,
        recruitmentId: null,
        updatedAt: now
      };
      await ref.set(updated);
      return this.mapMemberEntry(updated);
    }

    const document: MemberEntryDocument = {
      guildId: input.guildId,
      userId: input.userId,
      status: "pending",
      joinedAt: input.joinedAt,
      verificationChannelId: null,
      verificationMessageId: null,
      verifiedByUserId: null,
      verifiedAt: null,
      recruiterUserId: null,
      creditedAt: null,
      leftAt: null,
      recruitmentId: null,
      updatedAt: now
    };

    await ref.set(document);
    return this.mapMemberEntry(document);
  }

  async getMemberEntry(guildId: string, userId: string): Promise<MemberEntry | null> {
    const snapshot = await this.memberEntryRef(guildId, userId).get();
    return snapshot.exists ? this.mapMemberEntry(snapshot.data() as MemberEntryDocument) : null;
  }

  async setMemberEntryVerificationMessage(
    guildId: string,
    userId: string,
    channelId: string,
    messageId: string
  ): Promise<MemberEntry | null> {
    return this.updateMemberEntry(guildId, userId, {
      verificationChannelId: channelId,
      verificationMessageId: messageId
    });
  }

  async markMemberEntryVerifiedDirect(
    guildId: string,
    userId: string,
    verifiedByUserId: string
  ): Promise<MemberEntry | null> {
    const now = new Date().toISOString();
    return this.updateMemberEntry(guildId, userId, {
      status: "verified_direct",
      verifiedByUserId,
      verifiedAt: now
    });
  }

  async markMemberEntryRecruitmentPending(
    guildId: string,
    userId: string,
    recruiterUserId: string,
    recruitmentId: number
  ): Promise<MemberEntry | null> {
    return this.updateMemberEntry(guildId, userId, {
      status: "recruitment_pending",
      recruiterUserId,
      recruitmentId
    });
  }

  async markMemberEntryRecruited(
    guildId: string,
    userId: string,
    recruiterUserId: string,
    approvedByUserId: string,
    recruitmentId: number
  ): Promise<MemberEntry | null> {
    const now = new Date().toISOString();
    return this.updateMemberEntry(guildId, userId, {
      status: "recruited",
      recruiterUserId,
      verifiedByUserId: approvedByUserId,
      verifiedAt: now,
      creditedAt: now,
      recruitmentId
    });
  }

  async markMemberEntryCreditPending(
    guildId: string,
    userId: string,
    recruiterUserId: string,
    recruitmentId: number
  ): Promise<MemberEntry | null> {
    return this.updateMemberEntry(guildId, userId, {
      status: "credit_pending",
      recruiterUserId,
      recruitmentId
    });
  }

  async markMemberEntryCredited(
    guildId: string,
    userId: string,
    recruiterUserId: string,
    approvedByUserId: string,
    recruitmentId: number
  ): Promise<MemberEntry | null> {
    const now = new Date().toISOString();
    return this.updateMemberEntry(guildId, userId, {
      status: "credited",
      recruiterUserId,
      verifiedByUserId: approvedByUserId,
      creditedAt: now,
      recruitmentId
    });
  }

  async markMemberEntryRecruitmentRejected(
    guildId: string,
    userId: string,
    rejectedByUserId: string
  ): Promise<MemberEntry | null> {
    // Libera um novo `/recrutar` para o mesmo usuario: nenhum recrutador
    // creditado, nenhuma pendencia. `verifiedByUserId` guarda quem rejeitou
    // so como rastro de quem mexeu por ultimo na entrada.
    return this.updateMemberEntry(guildId, userId, {
      status: "recruitment_rejected",
      recruiterUserId: null,
      verifiedByUserId: rejectedByUserId,
      recruitmentId: null
    });
  }

  async markMemberEntryLeft(guildId: string, userId: string): Promise<MemberEntry | null> {
    const now = new Date().toISOString();
    return this.updateMemberEntry(guildId, userId, {
      status: "left",
      leftAt: now
    });
  }

  async enqueueMemberActionJob(input: EnqueueMemberActionJobInput): Promise<EnqueueMemberActionJobResult> {
    const now = new Date().toISOString();
    const id = this.memberActionJobId(input);
    const ref = this.memberActionJobRef(id);

    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const current = this.mapMemberActionJob(snapshot.data() as MemberActionJobDocument);
        if (
          current.status === "pending" ||
          current.status === "processing" ||
          (current.status === "completed" && input.type === "approve_recruitment")
        ) {
          return { job: current, created: false };
        }

        const updated: MemberActionJobDocument = {
          ...current,
          status: "pending",
          attempts: 0,
          startedAt: null,
          finishedAt: null,
          error: null,
          updatedAt: now
        };
        transaction.set(ref, updated);
        return { job: this.mapMemberActionJob(updated), created: true };
      }

      const document: MemberActionJobDocument = {
        id,
        type: input.type,
        status: "pending",
        guildId: input.guildId,
        userId: input.userId,
        requestedByUserId: input.requestedByUserId,
        recruitmentId: input.recruitmentId ?? null,
        attempts: 0,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        error: null,
        updatedAt: now
      };
      transaction.set(ref, document);
      return { job: this.mapMemberActionJob(document), created: true };
    });
  }

  async claimNextPendingMemberActionJob(): Promise<MemberActionJob | null> {
    const snapshot = await this.db
      .collection("memberActionJobs")
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const ref = snapshot.docs[0].ref;
    return this.db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(ref);
      if (!currentSnapshot.exists) {
        return null;
      }

      const current = currentSnapshot.data() as MemberActionJobDocument;
      if (current.status !== "pending") {
        return null;
      }

      const now = new Date().toISOString();
      const updated: MemberActionJobDocument = {
        ...current,
        status: "processing",
        attempts: current.attempts + 1,
        startedAt: now,
        updatedAt: now
      };
      transaction.set(ref, updated);
      return this.mapMemberActionJob(updated);
    });
  }

  async completeMemberActionJob(id: string): Promise<void> {
    await this.updateMemberActionJobStatus(id, "completed", null);
  }

  async failMemberActionJob(id: string, error: string): Promise<void> {
    await this.updateMemberActionJobStatus(id, "failed", error);
  }

  async cancelMemberActionJob(id: string, reason: string): Promise<void> {
    await this.updateMemberActionJobStatus(id, "cancelled", reason);
  }

  async resetStaleProcessingMemberActionJobs(staleAfterMs: number): Promise<number> {
    const cutoff = Date.now() - staleAfterMs;
    const snapshot = await this.db
      .collection("memberActionJobs")
      .where("status", "==", "processing")
      .get();

    const staleDocs = snapshot.docs.filter((doc) => {
      const data = doc.data() as MemberActionJobDocument;
      return !data.startedAt || new Date(data.startedAt).getTime() <= cutoff;
    });

    if (staleDocs.length === 0) {
      return 0;
    }

    const batch = this.db.batch();
    const now = new Date().toISOString();
    for (const doc of staleDocs) {
      batch.update(doc.ref, {
        status: "pending",
        startedAt: null,
        error: "Reset automatico de job travado.",
        updatedAt: now
      });
    }
    await batch.commit();
    return staleDocs.length;
  }

  watchPendingMemberActionJobs(onPending: () => void): () => void {
    return this.watchPendingJobs("memberActionJobs", "member_action_job", onPending);
  }

  /**
   * `recruitmentConfigs/{guildId}` — escrito SO pela dragons-platform. Aqui
   * so lemos, aplicando os MESMOS defaults que a plataforma aplica do outro
   * lado, para documento ausente ou parcial nao quebrar o fluxo.
   */
  async getRecruitmentFlowConfig(guildId: string): Promise<RecruitmentFlowConfig> {
    const snapshot = await this.recruitmentConfigRef(guildId).get();
    const data = snapshot.exists ? (snapshot.data() as Partial<RecruitmentFlowConfig>) : null;
    const defaults = DEFAULT_RECRUITMENT_FLOW_CONFIG;
    const now = new Date().toISOString();

    return {
      guildId,
      starterRoles: [...(data?.starterRoles ?? [])].sort((a, b) => a.order - b.order),
      areas: [...(data?.areas ?? [])].sort((a, b) => a.order - b.order),
      minAreas: data?.minAreas ?? defaults.minAreas,
      maxAreas: data?.maxAreas ?? defaults.maxAreas,
      stepOne: data?.stepOne ?? defaults.stepOne,
      stepTwo: data?.stepTwo ?? defaults.stepTwo,
      stepThree: data?.stepThree ?? defaults.stepThree,
      outcome: data?.outcome ?? defaults.outcome,
      sheet: data?.sheet ?? defaults.sheet,
      verificationTicket: data?.verificationTicket
        ? { ...defaults.verificationTicket, ...data.verificationTicket }
        : defaults.verificationTicket,
      familyAreaId: data?.familyAreaId ?? defaults.familyAreaId,
      familyRoute: data?.familyRoute
        ? { ...defaults.familyRoute, ...data.familyRoute }
        : defaults.familyRoute,
      areaRoute: data?.areaRoute
        ? { ...defaults.areaRoute, ...data.areaRoute }
        : defaults.areaRoute,
      approverRoleIds: data?.approverRoleIds ?? defaults.approverRoleIds,
      pointsGrantRoleIds: data?.pointsGrantRoleIds ?? defaults.pointsGrantRoleIds,
      pointsResetRoleIds: data?.pointsResetRoleIds ?? defaults.pointsResetRoleIds,
      pointsMode: data?.pointsMode ?? defaults.pointsMode,
      minManualPoints: data?.minManualPoints ?? defaults.minManualPoints,
      maxManualPoints: data?.maxManualPoints ?? defaults.maxManualPoints,
      draftTtlMinutes: data?.draftTtlMinutes ?? defaults.draftTtlMinutes,
      rolePendingText: data?.rolePendingText ?? defaults.rolePendingText,
      areasPendingText: data?.areasPendingText ?? defaults.areasPendingText,
      notRecruiterMessage: data?.notRecruiterMessage ?? defaults.notRecruiterMessage,
      notApproverMessage: data?.notApproverMessage ?? defaults.notApproverMessage,
      notDraftOwnerMessage: data?.notDraftOwnerMessage ?? defaults.notDraftOwnerMessage,
      notConfiguredMessage: data?.notConfiguredMessage ?? defaults.notConfiguredMessage,
      blockedAlreadyInFamilyMessage:
        data?.blockedAlreadyInFamilyMessage ?? defaults.blockedAlreadyInFamilyMessage,
      createdAt: data?.createdAt ?? now,
      updatedAt: data?.updatedAt ?? now
    };
  }

  async createRecruitmentDraft(input: CreateRecruitmentDraftInput): Promise<RecruitmentDraft> {
    const now = new Date();
    const ref = this.db.collection("recruitmentDrafts").doc();
    const document: RecruitmentDraftDocument = {
      id: ref.id,
      guildId: input.guildId,
      channelId: input.channelId,
      messageId: null,
      recruiterUserId: input.recruiterUserId,
      recruitUserId: input.recruitUserId,
      kind: input.kind,
      status: "selecting_role",
      starterRoleId: null,
      areaIds: [],
      presentation: input.presentation,
      recruitmentId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.ttlMinutes * 60_000).toISOString()
    };
    await ref.set(document);
    return this.mapRecruitmentDraft(document);
  }

  async getRecruitmentDraft(id: string): Promise<RecruitmentDraft | null> {
    const snapshot = await this.recruitmentDraftRef(id).get();
    return snapshot.exists
      ? this.mapRecruitmentDraft(snapshot.data() as RecruitmentDraftDocument)
      : null;
  }

  async setRecruitmentDraftMessage(id: string, channelId: string, messageId: string): Promise<void> {
    await this.recruitmentDraftRef(id).update({
      channelId,
      messageId,
      updatedAt: new Date().toISOString()
    });
  }

  async updateRecruitmentDraftSelection(
    id: string,
    input: UpdateRecruitmentDraftInput
  ): Promise<RecruitmentDraft | null> {
    return this.updateRecruitmentDraft(id, (data) => {
      if (!isEditableDraftStatus(data.status)) {
        return null;
      }
      return {
        ...data,
        starterRoleId: input.starterRoleId === undefined ? data.starterRoleId : input.starterRoleId,
        areaIds: input.areaIds ?? data.areaIds,
        status: input.status
      };
    });
  }

  async cancelRecruitmentDraft(id: string): Promise<RecruitmentDraft | null> {
    return this.updateRecruitmentDraft(id, (data) =>
      isEditableDraftStatus(data.status) ? { ...data, status: "cancelled" } : null
    );
  }

  async markRecruitmentDraftSubmitted(
    id: string,
    recruitmentId: number
  ): Promise<RecruitmentDraft | null> {
    return this.updateRecruitmentDraft(id, (data) =>
      isEditableDraftStatus(data.status) ? { ...data, status: "submitted", recruitmentId } : null
    );
  }

  /**
   * Varre os rascunhos cujo `expiresAt` passou e devolve os que ainda estavam
   * abertos, para o chamador editar as mensagens correspondentes.
   *
   * O documento e APAGADO no fim: rascunho e transitorio (tudo que importa ja
   * foi copiado para o recrutamento) e, sem isso, a consulta por `expiresAt`
   * devolveria os mesmos documentos vencidos para sempre. A consulta usa so
   * o campo `expiresAt` de proposito — combinar `status` com a desigualdade
   * exigiria um indice composto no Firestore.
   */
  async expireStaleRecruitmentDrafts(): Promise<RecruitmentDraft[]> {
    const now = new Date().toISOString();
    const snapshot = await this.db
      .collection("recruitmentDrafts")
      .where("expiresAt", "<=", now)
      .orderBy("expiresAt")
      .limit(50)
      .get();

    if (snapshot.empty) {
      return [];
    }

    const batch = this.db.batch();
    const expired: RecruitmentDraft[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data() as RecruitmentDraftDocument;
      if (isEditableDraftStatus(data.status)) {
        expired.push(this.mapRecruitmentDraft({ ...data, status: "expired", updatedAt: now }));
      }
      batch.delete(doc.ref);
    }
    await batch.commit();
    return expired;
  }

  /** Transacao comum das mudancas de estado do rascunho. */
  private async updateRecruitmentDraft(
    id: string,
    apply: (data: RecruitmentDraftDocument) => RecruitmentDraftDocument | null
  ): Promise<RecruitmentDraft | null> {
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const ref = this.recruitmentDraftRef(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return null;
      }

      const data = snapshot.data() as RecruitmentDraftDocument;
      const next = apply(data);
      if (!next) {
        return null;
      }

      const updated: RecruitmentDraftDocument = { ...next, updatedAt: now };
      transaction.update(ref, {
        status: updated.status,
        starterRoleId: updated.starterRoleId,
        areaIds: updated.areaIds,
        recruitmentId: updated.recruitmentId,
        updatedAt: now
      });
      return this.mapRecruitmentDraft(updated);
    });
  }

  async createRecruitment(input: CreateRecruitmentInput): Promise<Recruitment> {
    const now = new Date().toISOString();
    const recruitment = await this.db.runTransaction(async (transaction) => {
      const counterRef = this.counterRef("recruitments");
      const counterSnapshot = await transaction.get(counterRef);
      const nextId = ((counterSnapshot.data()?.nextId as number | undefined) ?? 1);
      transaction.set(counterRef, { nextId: nextId + 1 }, { merge: true });

      const document: RecruitmentDocument = {
        id: nextId,
        guildId: input.guildId,
        recruitUserId: input.recruitUserId,
        recruiterUserId: input.recruiterUserId,
        kind: input.kind ?? "standard",
        status: "pending",
        approvalMessageId: null,
        approvedByUserId: null,
        createdAt: now,
        approvedAt: null,
        starterRoleOptionId: input.starterRoleOptionId ?? null,
        starterRoleId: input.starterRoleId ?? null,
        starterRoleLabel: input.starterRoleLabel ?? null,
        areaOptionIds: input.areaOptionIds ?? [],
        areaRoleIds: input.areaRoleIds ?? [],
        areaLabels: input.areaLabels ?? [],
        points: input.points ?? 0,
        ticketId: input.ticketId ?? null,
        ticketThreadId: input.ticketThreadId ?? null,
        sheetChannelId: null,
        sheetMessageId: null,
        sheetPresentation: input.sheetPresentation ?? null,
        rejectedByUserId: null,
        rejectedAt: null
      };

      transaction.set(this.recruitmentRef(nextId), document);
      return this.mapRecruitment(document);
    });

    return recruitment;
  }

  async getRecruitment(id: number): Promise<Recruitment | null> {
    const snapshot = await this.recruitmentRef(id).get();
    return snapshot.exists ? this.mapRecruitment(snapshot.data() as RecruitmentDocument) : null;
  }

  async hasApprovedFamilyRecruitment(
    guildId: string,
    recruitUserId: string,
    familyAreaId: string
  ): Promise<boolean> {
    // Reusa o mesmo indice de `findPendingRecruitmentByUser` (guildId +
    // recruitUserId + status); o `array-contains` da area fica em memoria
    // (um usuario tem poucos recrutamentos aprovados).
    const snapshot = await this.db
      .collection("recruitments")
      .where("guildId", "==", guildId)
      .where("recruitUserId", "==", recruitUserId)
      .where("status", "==", "approved")
      .get();
    return snapshot.docs.some((doc) =>
      ((doc.data() as RecruitmentDocument).areaOptionIds ?? []).includes(familyAreaId)
    );
  }

  async findPendingRecruitmentByUser(guildId: string, recruitUserId: string): Promise<Recruitment | null> {
    const snapshot = await this.db
      .collection("recruitments")
      .where("guildId", "==", guildId)
      .where("recruitUserId", "==", recruitUserId)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return this.mapRecruitment(snapshot.docs[0].data() as RecruitmentDocument);
  }

  async setRecruitmentApprovalMessage(id: number, messageId: string): Promise<void> {
    await this.recruitmentRef(id).update({ approvalMessageId: messageId });
  }

  async addRecruitmentApprovalMessage(input: RecruitmentApprovalMessage): Promise<void> {
    await this.approvalMessageRef(input.recruitmentId, input.founderUserId).set({
      founderUserId: input.founderUserId,
      channelId: input.channelId,
      messageId: input.messageId
    });
  }

  async getRecruitmentApprovalMessages(recruitmentId: number): Promise<RecruitmentApprovalMessage[]> {
    const snapshot = await this.recruitmentRef(recruitmentId).collection("approvalMessages").get();
    return snapshot.docs.map((doc) => {
      const data = doc.data() as ApprovalMessageDocument;
      return {
        recruitmentId,
        founderUserId: data.founderUserId,
        channelId: data.channelId,
        messageId: data.messageId
      };
    });
  }

  async deletePendingRecruitment(id: number): Promise<void> {
    const recruitment = await this.getRecruitment(id);
    if (!recruitment || recruitment.status !== "pending") {
      return;
    }

    const approvalMessages = await this.getRecruitmentApprovalMessages(id);
    const batch = this.db.batch();
    for (const message of approvalMessages) {
      batch.delete(this.approvalMessageRef(id, message.founderUserId));
    }
    batch.delete(this.recruitmentRef(id));
    await batch.commit();
  }

  async setRecruitmentSheetMessage(id: number, channelId: string, messageId: string): Promise<void> {
    await this.recruitmentRef(id).update({
      sheetChannelId: channelId,
      sheetMessageId: messageId,
      // Mantido em sincronia com o campo legado para o fluxo antigo de
      // `updateApprovalMessages` continuar achando a mensagem.
      approvalMessageId: messageId
    });
  }

  async rejectRecruitment(id: number, rejectedByUserId: string): Promise<Recruitment | null> {
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const ref = this.recruitmentRef(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return null;
      }

      const data = snapshot.data() as RecruitmentDocument;
      if (data.status !== "pending") {
        return null;
      }

      transaction.update(ref, {
        status: "rejected",
        rejectedByUserId,
        rejectedAt: now
      });

      return this.mapRecruitment({
        ...data,
        status: "rejected",
        rejectedByUserId,
        rejectedAt: now
      });
    });
  }

  async approveRecruitment(id: number, approvedByUserId: string): Promise<Recruitment | null> {
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const ref = this.recruitmentRef(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return null;
      }

      const data = snapshot.data() as RecruitmentDocument;
      if (data.status !== "pending") {
        return null;
      }

      const updated: RecruitmentDocument = {
        ...data,
        status: "approved",
        approvedByUserId,
        approvedAt: now
      };
      transaction.update(ref, {
        status: updated.status,
        approvedByUserId: updated.approvedByUserId,
        approvedAt: updated.approvedAt
      });

      return this.mapRecruitment(updated);
    });
  }

  async approveRecruitmentAndAddMemberPoints(
    id: number,
    approvedByUserId: string,
    points: number,
    reason: string
  ): Promise<ApprovedRecruitmentResult | null> {
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const recruitmentRef = this.recruitmentRef(id);
      const recruitmentSnapshot = await transaction.get(recruitmentRef);
      if (!recruitmentSnapshot.exists) {
        return null;
      }

      const recruitmentData = recruitmentSnapshot.data() as RecruitmentDocument;
      if (recruitmentData.status !== "pending") {
        return null;
      }

      const updatedRecruitment: RecruitmentDocument = {
        ...recruitmentData,
        status: "approved",
        approvedByUserId,
        approvedAt: now
      };
      const memberRef = this.memberRef(updatedRecruitment.guildId, updatedRecruitment.recruiterUserId);
      const memberSnapshot = await transaction.get(memberRef);
      const hierarchyRoles = await this.getHierarchyRoles(updatedRecruitment.guildId);
      const currentMember = this.mapMemberFromSnapshot(
        updatedRecruitment.guildId,
        updatedRecruitment.recruiterUserId,
        memberSnapshot.data() as MemberDocument | undefined,
        hierarchyRoles
      );
      const previousRankName = currentMember.rankName;
      const previousRankRoleId = currentMember.rankRoleId;
      const nextPoints = currentMember.points + points;
      const nextRecruitments = currentMember.recruitments + 1;
      const nextRank = this.getRankForPoints(nextPoints, hierarchyRoles);
      const updatedMember: MemberProfile = {
        guildId: updatedRecruitment.guildId,
        userId: updatedRecruitment.recruiterUserId,
        points: nextPoints,
        recruitments: nextRecruitments,
        rankName: nextRank.name,
        rankRoleId: nextRank.roleId,
        updatedAt: now
      };

      transaction.update(recruitmentRef, {
        status: "approved",
        approvedByUserId,
        approvedAt: now
      });
      transaction.set(memberRef, updatedMember);
      transaction.create(this.memberPointEventRef(), {
        guildId: updatedRecruitment.guildId,
        userId: updatedRecruitment.recruiterUserId,
        points,
        reason,
        source: "recruitment",
        recruitmentId: id,
        createdAt: now,
        createdAtTimestamp: Timestamp.now()
      });

      return {
        recruitment: this.mapRecruitment(updatedRecruitment),
        member: updatedMember,
        previousRankName,
        previousRankRoleId,
        rankChanged: previousRankRoleId !== updatedMember.rankRoleId
      };
    });
  }

  async addMemberPoints(
    guildId: string,
    userId: string,
    points: number,
    reason: string
  ): Promise<MemberProfile> {
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const memberRef = this.memberRef(guildId, userId);
      const snapshot = await transaction.get(memberRef);
      const hierarchyRoles = await this.getHierarchyRoles(guildId);
      const currentMember = this.mapMemberFromSnapshot(guildId, userId, snapshot.data() as MemberDocument | undefined, hierarchyRoles);
      const nextPoints = currentMember.points + points;
      const nextRank = this.getRankForPoints(nextPoints, hierarchyRoles);
      const updatedMember: MemberProfile = {
        guildId,
        userId,
        points: nextPoints,
        recruitments: currentMember.recruitments,
        rankName: nextRank.name,
        rankRoleId: nextRank.roleId,
        updatedAt: now
      };

      transaction.set(memberRef, updatedMember);
      transaction.create(this.memberPointEventRef(), {
        guildId,
        userId,
        points,
        reason,
        createdAt: now,
        createdAtTimestamp: Timestamp.now()
      });

      return updatedMember;
    });
  }

  async resetMemberPoints(guildId: string, userId: string, reason: string): Promise<MemberProfile> {
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const memberRef = this.memberRef(guildId, userId);
      const snapshot = await transaction.get(memberRef);
      const hierarchyRoles = await this.getHierarchyRoles(guildId);
      const current = this.mapMemberFromSnapshot(
        guildId,
        userId,
        snapshot.data() as MemberDocument | undefined,
        hierarchyRoles
      );
      const baseRank = this.getRankForPoints(0, hierarchyRoles);
      const updated: MemberProfile = {
        guildId,
        userId,
        points: 0,
        recruitments: current.recruitments,
        rankName: baseRank.name,
        rankRoleId: baseRank.roleId,
        updatedAt: now
      };
      transaction.set(memberRef, updated);
      if (current.points !== 0) {
        transaction.create(this.memberPointEventRef(), {
          guildId,
          userId,
          points: -current.points,
          reason,
          createdAt: now,
          createdAtTimestamp: Timestamp.now()
        });
      }
      return updated;
    });
  }

  async resetAllMemberPoints(guildId: string, reason: string): Promise<number> {
    const hierarchyRoles = await this.getHierarchyRoles(guildId);
    const baseRank = this.getRankForPoints(0, hierarchyRoles);
    const snapshot = await this.db.collection("members").where("guildId", "==", guildId).get();
    const now = new Date().toISOString();
    let affected = 0;
    let batch = this.db.batch();
    let pending = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data() as MemberDocument;
      if ((data.points ?? 0) === 0) {
        continue;
      }
      batch.set(doc.ref, {
        ...data,
        points: 0,
        rankName: baseRank.name,
        rankRoleId: baseRank.roleId,
        updatedAt: now
      });
      batch.create(this.memberPointEventRef(), {
        guildId,
        userId: data.userId,
        points: -(data.points ?? 0),
        reason,
        createdAt: now,
        createdAtTimestamp: Timestamp.now()
      });
      affected += 1;
      pending += 2;
      // Firestore limita um batch a 500 escritas.
      if (pending >= 450) {
        await batch.commit();
        batch = this.db.batch();
        pending = 0;
      }
    }
    if (pending > 0) {
      await batch.commit();
    }
    return affected;
  }

  async ensureMemberProfile(guildId: string, userId: string): Promise<MemberProfileResult> {
    const now = new Date().toISOString();
    const ref = this.memberRef(guildId, userId);
    const hierarchyRoles = await this.getHierarchyRoles(guildId);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      const profile = this.mapMemberFromSnapshot(guildId, userId, snapshot.data() as MemberDocument, hierarchyRoles);
      return { profile, rank: this.getRankForPoints(profile.points, hierarchyRoles) };
    }

    const baseRank = this.getRankForPoints(0, hierarchyRoles);
    const profile: MemberProfile = {
      guildId,
      userId,
      points: 0,
      recruitments: 0,
      rankName: baseRank.name,
      rankRoleId: baseRank.roleId,
      updatedAt: now
    };
    await ref.set(profile);
    return { profile, rank: baseRank };
  }

  async getMemberProfile(guildId: string, userId: string): Promise<MemberProfileResult> {
    const hierarchyRoles = await this.getHierarchyRoles(guildId);
    const snapshot = await this.memberRef(guildId, userId).get();
    const profile = this.mapMemberFromSnapshot(guildId, userId, snapshot.data() as MemberDocument | undefined, hierarchyRoles);
    return { profile, rank: this.getRankForPoints(profile.points, hierarchyRoles) };
  }

  async getMemberRanking(guildId: string, limit: number): Promise<MemberRankingEntry[]> {
    const safeLimit = Math.max(1, Math.min(limit, 25));
    const hierarchyRoles = await this.getHierarchyRoles(guildId);
    const snapshot = await this.db
      .collection("members")
      .where("guildId", "==", guildId)
      .get();

    return snapshot.docs
      .map((doc, index) => ({
        position: index + 1,
        ...this.mapMemberFromSnapshot(guildId, doc.id.split("_").slice(1).join("_"), doc.data() as MemberDocument, hierarchyRoles)
      }))
      .filter((entry) => entry.points > 0)
      .sort((a, b) => b.points - a.points || b.recruitments - a.recruitments || a.userId.localeCompare(b.userId))
      .slice(0, safeLimit)
      .map((entry, index) => ({ ...entry, position: index + 1 }));
  }

  async createPanel(
    guildId: string,
    id: string,
    title: string,
    description?: string
  ): Promise<PanelConfig> {
    const ref = this.panelRef(guildId, id);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      throw new Error(`Ja existe um painel com o id "${id}" neste servidor.`);
    }

    const now = new Date().toISOString();
    const content = description && description.trim() ? `## ${title}\n\n${description}` : `## ${title}`;
    const document: PanelDocument = {
      id,
      guildId,
      color: null,
      blocks: [{ type: "text", content }],
      createdAt: now,
      updatedAt: now,
      publishedChannelId: null,
      publishedMessageId: null
    };
    await ref.set(document);
    return this.mapPanel(document);
  }

  /** Le o painel (ja migrado para blocos) e grava a nova lista de blocos. */
  private async updatePanelBlocks(
    guildId: string,
    id: string,
    mutate: (blocks: PanelBlock[]) => PanelBlock[]
  ): Promise<PanelConfig> {
    const ref = this.panelRef(guildId, id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Painel "${id}" nao encontrado.`);
    }
    const current = this.mapPanel(snapshot.data() as PanelDocument);
    const blocks = mutate([...current.blocks]);
    await ref.update({ blocks, updatedAt: new Date().toISOString() });
    return this.getPanel(guildId, id) as Promise<PanelConfig>;
  }

  async getPanel(guildId: string, id: string): Promise<PanelConfig | null> {
    const snapshot = await this.panelRef(guildId, id).get();
    return snapshot.exists ? this.mapPanel(snapshot.data() as PanelDocument) : null;
  }

  async listPanels(guildId: string): Promise<PanelConfig[]> {
    const snapshot = await this.db.collection("panels").where("guildId", "==", guildId).get();
    return snapshot.docs
      .map((doc) => this.mapPanel(doc.data() as PanelDocument))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async setPanelImage(guildId: string, id: string, imageUrl: string): Promise<PanelConfig> {
    // Upsert de um bloco de banner: atualiza o 1o bloco `image`, ou insere
    // um no topo se nao houver.
    return this.updatePanelBlocks(guildId, id, (blocks) => {
      const first = blocks.findIndex((block) => block.type === "image");
      if (first >= 0) {
        blocks[first] = { type: "image", url: imageUrl };
        return blocks;
      }
      return [{ type: "image", url: imageUrl }, ...blocks];
    });
  }

  async setPanelColor(guildId: string, id: string, color: string | null): Promise<PanelConfig> {
    const ref = this.panelRef(guildId, id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Painel "${id}" nao encontrado.`);
    }

    await ref.update({ color, updatedAt: new Date().toISOString() });
    return this.getPanel(guildId, id) as Promise<PanelConfig>;
  }

  async addPanelButton(
    guildId: string,
    id: string,
    button: Omit<PanelButtonConfig, "order">
  ): Promise<PanelConfig> {
    return this.updatePanelBlocks(guildId, id, (blocks) => {
      const all = blocks.flatMap((b) => (b.type === "buttons" ? b.buttons : []));
      if (all.some((existing) => existing.id === button.id)) {
        throw new Error(`Ja existe um botao com o id "${button.id}" neste painel.`);
      }
      if (all.length >= 25) {
        throw new Error("Este painel ja atingiu o limite de 25 botoes.");
      }
      const withOrder: PanelButtonConfig = { ...button, order: 0 };
      const lastButtons = [...blocks].reverse().find((b) => b.type === "buttons");
      if (lastButtons && lastButtons.type === "buttons") {
        lastButtons.buttons = [...lastButtons.buttons, withOrder].map((b, i) => ({ ...b, order: i }));
        return blocks;
      }
      return [...blocks, { type: "buttons", buttons: [{ ...withOrder, order: 0 }] }];
    });
  }

  async removePanelButton(guildId: string, id: string, buttonId: string): Promise<PanelConfig> {
    return this.updatePanelBlocks(guildId, id, (blocks) =>
      blocks
        .map((block) => {
          if (block.type !== "buttons") return block;
          return {
            type: "buttons" as const,
            buttons: block.buttons
              .filter((b) => b.id !== buttonId)
              .map((b, i) => ({ ...b, order: i }))
          };
        })
        .filter((block) => block.type !== "buttons" || block.buttons.length > 0)
    );
  }

  async deletePanel(guildId: string, id: string): Promise<void> {
    await this.panelRef(guildId, id).delete();
  }

  async setPanelPublishedMessage(guildId: string, id: string, channelId: string, messageId: string): Promise<void> {
    const ref = this.panelRef(guildId, id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Painel "${id}" nao encontrado.`);
    }

    await ref.update({
      publishedChannelId: channelId,
      publishedMessageId: messageId,
      updatedAt: new Date().toISOString()
    });
  }

  async claimNextPendingPanelJob(): Promise<PanelJob | null> {
    // Sorted in memory (rather than via `.orderBy("createdAt")` combined with the
    // `.where("status", ...)` equality clause) to avoid requiring a new Firestore
    // composite index just for this low-volume internal queue.
    const snapshot = await this.db
      .collection("panelJobs")
      .where("status", "==", "pending")
      .get();

    if (snapshot.empty) {
      return null;
    }

    const oldestDoc = snapshot.docs.reduce((oldest, doc) => {
      const oldestCreatedAt = (oldest.data() as PanelJobDocument).createdAt;
      const currentCreatedAt = (doc.data() as PanelJobDocument).createdAt;
      return currentCreatedAt < oldestCreatedAt ? doc : oldest;
    });

    const ref = oldestDoc.ref;
    return this.db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(ref);
      if (!currentSnapshot.exists) {
        return null;
      }

      const current = currentSnapshot.data() as PanelJobDocument;
      if (current.status !== "pending") {
        return null;
      }

      const now = new Date().toISOString();
      const updated: PanelJobDocument = {
        ...current,
        status: "processing",
        updatedAt: now
      };
      transaction.set(ref, updated);
      return this.mapPanelJob(updated);
    });
  }

  async completePanelJob(id: string, messageId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.panelJobRef(id).set(
      {
        status: "completed",
        messageId,
        error: null,
        updatedAt: now
      },
      { merge: true }
    );
  }

  async failPanelJob(id: string, error: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.runTransaction(async (transaction) => {
      const ref = this.panelJobRef(id);
      const snapshot = await transaction.get(ref);
      const current = snapshot.data() as PanelJobDocument | undefined;
      transaction.set(
        ref,
        {
          status: "failed",
          error,
          attempts: (current?.attempts ?? 0) + 1,
          updatedAt: now
        },
        { merge: true }
      );
    });
  }

  async resetStalePanelJobs(staleAfterMs: number): Promise<number> {
    const cutoff = Date.now() - staleAfterMs;
    const snapshot = await this.db
      .collection("panelJobs")
      .where("status", "==", "processing")
      .get();

    const staleDocs = snapshot.docs.filter((doc) => {
      const data = doc.data() as PanelJobDocument;
      return new Date(data.updatedAt).getTime() <= cutoff;
    });

    if (staleDocs.length === 0) {
      return 0;
    }

    const batch = this.db.batch();
    const now = new Date().toISOString();
    for (const doc of staleDocs) {
      batch.update(doc.ref, {
        status: "pending",
        error: "Reset automatico de job travado.",
        updatedAt: now
      });
    }
    await batch.commit();
    return staleDocs.length;
  }

  watchPendingPanelJobs(onPending: () => void): () => void {
    return this.watchPendingJobs("panelJobs", "panel_job", onPending);
  }

  /**
   * Observador compartilhado das filas internas. Um `onSnapshot` na query
   * `status == "pending"` (indice de campo unico, sem indice composto) dispara
   * `onPending` quando ha job pendente. Se o listener cair (ex.: rede,
   * `RESOURCE_EXHAUSTED`), reassina sozinho apos um intervalo — a rede de
   * seguranca do worker cobre o buraco enquanto isso.
   */
  private watchPendingJobs(
    collection: string,
    logPrefix: string,
    onPending: () => void
  ): () => void {
    const RESUBSCRIBE_DELAY_MS = 30_000;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let resubscribeTimer: ReturnType<typeof setTimeout> | null = null;

    const subscribe = (): void => {
      if (cancelled) {
        return;
      }
      unsubscribe = this.db
        .collection(collection)
        .where("status", "==", "pending")
        .onSnapshot(
          (snapshot) => {
            if (!snapshot.empty) {
              onPending();
            }
          },
          (error) => {
            unsubscribe = null;
            logger.error(`${logPrefix}.watch_failed`, error, {
              resubscribeMs: RESUBSCRIBE_DELAY_MS
            });
            if (!cancelled) {
              resubscribeTimer = setTimeout(subscribe, RESUBSCRIBE_DELAY_MS);
            }
          }
        );
    };

    subscribe();

    return () => {
      cancelled = true;
      if (resubscribeTimer) {
        clearTimeout(resubscribeTimer);
        resubscribeTimer = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
  }

  private mapPanel(data: PanelDocument): PanelConfig {
    const rawBlocks: PanelBlock[] =
      Array.isArray(data.blocks) && data.blocks.length > 0
        ? data.blocks
        : panelBlocksFromLegacy({
            title: data.title,
            description: data.description,
            imageUrl: data.imageUrl ?? null,
            kind: data.kind,
            buttons: data.buttons ? data.buttons.map((b) => this.mapPanelButton(b)) : undefined,
            select: this.mapPanelSelect(data.select)
          });
    return {
      id: data.id,
      guildId: data.guildId,
      color: data.color ?? null,
      blocks: rawBlocks.map((block) => this.normalizePanelBlock(block)),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      publishedChannelId: data.publishedChannelId ?? null,
      publishedMessageId: data.publishedMessageId ?? null
    };
  }

  private normalizePanelBlock(block: PanelBlock): PanelBlock {
    if (block.type === "buttons") {
      return {
        type: "buttons",
        buttons: [...block.buttons]
          .sort((a, b) => a.order - b.order)
          .map((button) => this.mapPanelButton(button as PanelButtonDocument))
      };
    }
    if (block.type === "select") {
      const mapped = this.mapPanelSelect({
        placeholder: block.placeholder,
        options: block.options as unknown as PanelSelectDocument["options"]
      });
      return {
        type: "select",
        placeholder: mapped?.placeholder ?? block.placeholder,
        options: mapped?.options ?? []
      };
    }
    return block;
  }

  /**
   * Backfill on read: documentos antigos nao tem `action` no botao — monta
   * uma acao `reply` a partir dos campos legados
   * (`response`/`responseImageUrl`/`responseColor`), que continuam gravados.
   */
  private mapPanelButton(button: PanelButtonDocument): PanelButtonConfig {
    const response = button.response ?? "";
    const responseImageUrl = button.responseImageUrl ?? null;
    const responseColor = button.responseColor ?? null;
    return {
      id: button.id,
      label: button.label,
      emoji: button.emoji ?? null,
      style: button.style,
      response,
      responseImageUrl,
      responseColor,
      action: button.action ?? { type: "reply", response, responseImageUrl, responseColor },
      order: button.order
    };
  }

  private mapPanelSelect(select: PanelSelectDocument | null | undefined): PanelSelectConfig | null {
    if (!select) {
      return null;
    }
    return {
      placeholder: select.placeholder,
      options: [...select.options]
        .sort((a, b) => a.order - b.order)
        .map((option) => ({
          id: option.id,
          label: option.label,
          description: option.description ?? null,
          emoji: option.emoji ?? null,
          action:
            option.action ??
            ({ type: "reply", response: "", responseImageUrl: null, responseColor: null } as PanelActionConfig),
          order: option.order
        }))
    };
  }

  private mapPanelJob(data: PanelJobDocument): PanelJob {
    return {
      id: data.id,
      guildId: data.guildId,
      panelId: data.panelId,
      channelId: data.channelId,
      requestedByUserId: data.requestedByUserId,
      status: data.status,
      messageId: data.messageId ?? null,
      attempts: data.attempts,
      error: data.error ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
  }

  private panelRef(guildId: string, id: string) {
    return this.db.collection("panels").doc(`${guildId}_${id}`);
  }

  private panelJobRef(id: string) {
    return this.db.collection("panelJobs").doc(id);
  }

  private supportCategoryRef(guildId: string, id: string) {
    return this.db.collection("supportCategories").doc(`${guildId}_${id}`);
  }

  private ticketRef(id: string) {
    return this.db.collection("tickets").doc(id);
  }

  private ticketSlotRef(guildId: string, openerUserId: string) {
    return this.db.collection("openTicketKeys").doc(`${guildId}_${openerUserId}`);
  }

  async getSupportCategory(guildId: string, id: string): Promise<SupportCategoryConfig | null> {
    const snapshot = await this.supportCategoryRef(guildId, id).get();
    if (!snapshot.exists) {
      return null;
    }
    const data = snapshot.data() as SupportCategoryDocument;
    if (data.guildId !== guildId) {
      return null;
    }
    return this.mapSupportCategory(data);
  }

  async listSupportCategories(guildId: string): Promise<SupportCategoryConfig[]> {
    const snapshot = await this.db
      .collection("supportCategories")
      .where("guildId", "==", guildId)
      .get();
    return snapshot.docs
      .map((doc) => this.mapSupportCategory(doc.data() as SupportCategoryDocument))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async claimTicketSlot(guildId: string, openerUserId: string): Promise<boolean> {
    const ref = this.ticketSlotRef(guildId, openerUserId);
    try {
      await ref.create({ guildId, openerUserId, createdAt: new Date().toISOString() });
      return true;
    } catch (error) {
      // `create` falha com ALREADY_EXISTS (codigo 6) quando o usuario ja tem
      // um ticket aberto — e o caminho esperado, nao um erro real.
      if (typeof error === "object" && error !== null && (error as { code?: number }).code === 6) {
        return false;
      }
      throw error;
    }
  }

  async releaseTicketSlot(guildId: string, openerUserId: string): Promise<void> {
    await this.ticketSlotRef(guildId, openerUserId).delete();
  }

  async createTicket(input: CreateTicketInput): Promise<TicketRecord> {
    const ref = this.ticketRef(input.id ?? this.db.collection("tickets").doc().id);
    const now = new Date().toISOString();
    const document: TicketDocument = {
      id: ref.id,
      guildId: input.guildId,
      panelId: input.panelId,
      categoryId: input.categoryId ?? "",
      openerUserId: input.openerUserId,
      parentChannelId: input.parentChannelId,
      threadId: input.threadId,
      pingMessageId: input.pingMessageId,
      status: "open",
      kind: input.kind ?? "support",
      declaredRecruiterUserId: input.declaredRecruiterUserId ?? null,
      escalateAt: input.escalateAt ?? null,
      escalatedAt: null,
      recruitmentId: null,
      claimedByUserId: null,
      claimedAt: null,
      closedByUserId: null,
      closedAt: null,
      feedbackRating: null,
      feedbackComment: null,
      createdAt: now,
      updatedAt: now
    };
    await ref.set(document);
    return this.mapTicket(document);
  }

  async getTicket(ticketId: string): Promise<TicketRecord | null> {
    const snapshot = await this.ticketRef(ticketId).get();
    return snapshot.exists ? this.mapTicket(snapshot.data() as TicketDocument) : null;
  }

  async claimTicket(ticketId: string, claimerUserId: string): Promise<TicketRecord | null> {
    const ref = this.ticketRef(ticketId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return null;
      }
      const current = snapshot.data() as TicketDocument;
      if (current.status !== "open") {
        return this.mapTicket(current);
      }
      const now = new Date().toISOString();
      const updated: TicketDocument = {
        ...current,
        status: "claimed",
        claimedByUserId: claimerUserId,
        claimedAt: now,
        updatedAt: now
      };
      transaction.set(ref, updated);
      return this.mapTicket(updated);
    });
  }

  async closeTicket(ticketId: string, closerUserId: string): Promise<TicketRecord | null> {
    const ref = this.ticketRef(ticketId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        return null;
      }
      const current = snapshot.data() as TicketDocument;
      if (current.status === "closed") {
        return null;
      }
      const now = new Date().toISOString();
      const updated: TicketDocument = {
        ...current,
        status: "closed",
        closedByUserId: closerUserId,
        closedAt: now,
        updatedAt: now
      };
      transaction.set(ref, updated);
      return this.mapTicket(updated);
    });
  }

  async getVerificationTicketByThread(
    guildId: string,
    threadId: string
  ): Promise<TicketRecord | null> {
    const snapshot = await this.db
      .collection("tickets")
      .where("threadId", "==", threadId)
      .limit(5)
      .get();
    const match = snapshot.docs
      .map((doc) => this.mapTicket(doc.data() as TicketDocument))
      .find((ticket) => ticket.guildId === guildId && ticket.kind === "verification");
    return match ?? null;
  }

  async linkTicketRecruitment(ticketId: string, recruitmentId: number): Promise<void> {
    await this.ticketRef(ticketId).update({
      recruitmentId,
      escalateAt: null,
      updatedAt: new Date().toISOString()
    });
  }

  async markTicketEscalated(ticketId: string): Promise<void> {
    await this.ticketRef(ticketId).update({
      escalatedAt: new Date().toISOString(),
      escalateAt: null,
      updatedAt: new Date().toISOString()
    });
  }

  async listTicketsToEscalate(nowIso: string): Promise<TicketRecord[]> {
    // Volume baixo (so tickets de verificacao abertos com recrutador
    // declarado). Filtra `escalateAt`/status em memoria para nao exigir um
    // indice composto novo.
    const snapshot = await this.db
      .collection("tickets")
      .where("kind", "==", "verification")
      .get();
    return snapshot.docs
      .map((doc) => this.mapTicket(doc.data() as TicketDocument))
      .filter(
        (ticket) =>
          ticket.escalateAt !== null &&
          ticket.escalatedAt === null &&
          ticket.escalateAt <= nowIso &&
          (ticket.status === "open" || ticket.status === "claimed")
      );
  }

  private mapSupportCategory(data: SupportCategoryDocument): SupportCategoryConfig {
    return {
      id: data.id,
      guildId: data.guildId,
      name: data.name,
      parentChannelId: data.parentChannelId,
      supportRoleIds: data.supportRoleIds ?? [],
      viewerRoleIds: data.viewerRoleIds ?? [],
      threadNameTemplate: data.threadNameTemplate,
      openMessage: data.openMessage,
      claimMessage: data.claimMessage,
      closeMessage: data.closeMessage,
      closeAction: data.closeAction ?? "archive-remove",
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
  }

  private mapTicket(data: TicketDocument): TicketRecord {
    return {
      id: data.id,
      guildId: data.guildId,
      panelId: data.panelId,
      categoryId: data.categoryId,
      openerUserId: data.openerUserId,
      parentChannelId: data.parentChannelId,
      threadId: data.threadId,
      pingMessageId: data.pingMessageId,
      status: data.status,
      kind: data.kind ?? "support",
      declaredRecruiterUserId: data.declaredRecruiterUserId ?? null,
      escalateAt: data.escalateAt ?? null,
      escalatedAt: data.escalatedAt ?? null,
      recruitmentId: data.recruitmentId ?? null,
      claimedByUserId: data.claimedByUserId ?? null,
      claimedAt: data.claimedAt ?? null,
      closedByUserId: data.closedByUserId ?? null,
      closedAt: data.closedAt ?? null,
      feedbackRating: data.feedbackRating ?? null,
      feedbackComment: data.feedbackComment ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    };
  }

  async addToBlacklist(guildId: string, userId: string, reason: string, addedByUserId: string): Promise<BlacklistEntry> {
    const now = new Date().toISOString();
    const document: BlacklistDocument = {
      guildId,
      userId,
      reason,
      addedByUserId,
      addedAt: now
    };
    await this.blacklistRef(guildId, userId).set(document);
    return this.mapBlacklistEntry(document);
  }

  async removeFromBlacklist(guildId: string, userId: string): Promise<BlacklistEntry | null> {
    const ref = this.blacklistRef(guildId, userId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return null;
    }

    const entry = this.mapBlacklistEntry(snapshot.data() as BlacklistDocument);
    await ref.delete();
    return entry;
  }

  async getBlacklistEntry(guildId: string, userId: string): Promise<BlacklistEntry | null> {
    const snapshot = await this.blacklistRef(guildId, userId).get();
    return snapshot.exists ? this.mapBlacklistEntry(snapshot.data() as BlacklistDocument) : null;
  }

  async listBlacklist(guildId: string): Promise<BlacklistEntry[]> {
    const snapshot = await this.db.collection("blacklist").where("guildId", "==", guildId).get();
    return snapshot.docs
      .map((doc) => this.mapBlacklistEntry(doc.data() as BlacklistDocument))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  private mapBlacklistEntry(data: BlacklistDocument): BlacklistEntry {
    return {
      guildId: data.guildId,
      userId: data.userId,
      reason: data.reason,
      addedByUserId: data.addedByUserId,
      addedAt: data.addedAt
    };
  }

  private blacklistRef(guildId: string, userId: string) {
    return this.db.collection("blacklist").doc(`${guildId}_${userId}`);
  }

  private loadServiceAccount(): ServiceAccount {
    if (!this.env.firebaseServiceAccountPath) {
      throw new Error("Firestore requer FIREBASE_SERVICE_ACCOUNT_PATH apontando para o JSON da service account.");
    }

    return JSON.parse(readFileSync(this.env.firebaseServiceAccountPath, "utf8")) as ServiceAccount;
  }

  private async ensureGuildConfig(guildId: string): Promise<void> {
    const ref = this.guildConfigRef(guildId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      await ref.set(this.defaultGuildConfigDocument());
    }
  }

  private defaultGuildConfigDocument(): GuildConfigDocument {
    return {
      recruiterRoleId: DEFAULT_RECRUITER_ROLE_ID,
      founderRoleId: DEFAULT_FOUNDER_ROLE_ID,
      memberRoleId: DEFAULT_MEMBER_ROLE_ID,
      approvalChannelId: null,
      recruitmentAnnouncementChannelId: DEFAULT_RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID,
      blacklistLogChannelId: DEFAULT_BLACKLIST_LOG_CHANNEL_ID,
      memberVerificationChannelId: MEMBER_VERIFICATION_CHANNEL_ID,
      memberExitChannelId: MEMBER_EXIT_CHANNEL_ID,
      recruitmentPoints: RECRUITMENT_POINTS,
      hierarchySeeded: false
    };
  }

  private mapGuildConfig(guildId: string, data: GuildConfigDocument): GuildConfig {
    return {
      guildId,
      recruiterRoleId: data.recruiterRoleId,
      founderRoleId: data.founderRoleId,
      memberRoleId: data.memberRoleId,
      approvalChannelId: data.approvalChannelId ?? null,
      recruitmentAnnouncementChannelId: data.recruitmentAnnouncementChannelId ?? DEFAULT_RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID,
      blacklistLogChannelId: data.blacklistLogChannelId ?? DEFAULT_BLACKLIST_LOG_CHANNEL_ID,
      memberVerificationChannelId: data.memberVerificationChannelId ?? MEMBER_VERIFICATION_CHANNEL_ID,
      memberExitChannelId: data.memberExitChannelId ?? MEMBER_EXIT_CHANNEL_ID,
      recruitmentPoints: data.recruitmentPoints ?? RECRUITMENT_POINTS,
      hierarchySeeded: data.hierarchySeeded ?? false
    };
  }

  private mapRecruitment(data: RecruitmentDocument): Recruitment {
    return {
      id: data.id,
      guildId: data.guildId,
      recruitUserId: data.recruitUserId,
      recruiterUserId: data.recruiterUserId,
      kind: data.kind ?? "standard",
      status: data.status,
      approvalMessageId: data.approvalMessageId,
      approvedByUserId: data.approvedByUserId,
      createdAt: data.createdAt,
      approvedAt: data.approvedAt,
      starterRoleOptionId: data.starterRoleOptionId ?? null,
      starterRoleId: data.starterRoleId ?? null,
      starterRoleLabel: data.starterRoleLabel ?? null,
      areaOptionIds: data.areaOptionIds ?? [],
      areaRoleIds: data.areaRoleIds ?? [],
      areaLabels: data.areaLabels ?? [],
      points: data.points ?? 0,
      ticketId: data.ticketId ?? null,
      ticketThreadId: data.ticketThreadId ?? null,
      sheetChannelId: data.sheetChannelId ?? null,
      sheetMessageId: data.sheetMessageId ?? null,
      sheetPresentation: data.sheetPresentation ?? null,
      rejectedByUserId: data.rejectedByUserId ?? null,
      rejectedAt: data.rejectedAt ?? null
    };
  }

  private mapRecruitmentDraft(data: RecruitmentDraftDocument): RecruitmentDraft {
    return {
      id: data.id,
      guildId: data.guildId,
      channelId: data.channelId,
      messageId: data.messageId ?? null,
      recruiterUserId: data.recruiterUserId,
      recruitUserId: data.recruitUserId,
      kind: data.kind ?? "standard",
      status: data.status,
      starterRoleId: data.starterRoleId ?? null,
      areaIds: data.areaIds ?? [],
      presentation: data.presentation,
      recruitmentId: data.recruitmentId ?? null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      expiresAt: data.expiresAt
    };
  }

  private mapMemberEntry(data: MemberEntryDocument): MemberEntry {
    return {
      guildId: data.guildId,
      userId: data.userId,
      status: data.status,
      joinedAt: data.joinedAt,
      verificationChannelId: data.verificationChannelId ?? null,
      verificationMessageId: data.verificationMessageId ?? null,
      verifiedByUserId: data.verifiedByUserId ?? null,
      verifiedAt: data.verifiedAt ?? null,
      recruiterUserId: data.recruiterUserId ?? null,
      creditedAt: data.creditedAt ?? null,
      leftAt: data.leftAt ?? null,
      recruitmentId: data.recruitmentId ?? null,
      updatedAt: data.updatedAt
    };
  }

  private mapMemberActionJob(data: MemberActionJobDocument): MemberActionJob {
    return {
      id: data.id,
      type: data.type,
      status: data.status,
      guildId: data.guildId,
      userId: data.userId,
      requestedByUserId: data.requestedByUserId,
      recruitmentId: data.recruitmentId ?? null,
      attempts: data.attempts,
      createdAt: data.createdAt,
      startedAt: data.startedAt ?? null,
      finishedAt: data.finishedAt ?? null,
      error: data.error ?? null,
      updatedAt: data.updatedAt
    };
  }

  private mapMemberFromSnapshot(
    guildId: string,
    userId: string,
    data: Partial<MemberDocument> | undefined,
    hierarchyRoles: HierarchyRole[]
  ): MemberProfile {
    const points = data?.points ?? 0;
    const rank = this.getRankForPoints(points, hierarchyRoles);
    return {
      guildId,
      userId,
      points,
      recruitments: data?.recruitments ?? 0,
      rankName: data?.rankName ?? rank.name,
      rankRoleId: data?.rankRoleId ?? rank.roleId,
      updatedAt: data?.updatedAt ?? new Date(0).toISOString()
    };
  }

  private getRankForPoints(points: number, hierarchyRoles: HierarchyRole[]): HierarchyRole {
    const sortedRoles = [...hierarchyRoles].sort((a, b) => b.points - a.points || b.order - a.order);
    return sortedRoles.find((rank) => points >= rank.points) ?? DEFAULT_HIERARCHY_ROLES[0];
  }

  private mapHierarchyRole(data: HierarchyRoleDocument): HierarchyRole {
    return {
      name: data.name,
      roleId: data.roleId,
      points: data.points,
      order: data.order
    };
  }

  private guildConfigRef(guildId: string) {
    return this.db.collection("guildConfigs").doc(guildId);
  }

  private recruitmentRef(id: number) {
    return this.db.collection("recruitments").doc(String(id));
  }

  private approvalMessageRef(recruitmentId: number, founderUserId: string) {
    return this.recruitmentRef(recruitmentId).collection("approvalMessages").doc(founderUserId);
  }

  private memberRef(guildId: string, userId: string) {
    return this.db.collection("members").doc(`${guildId}_${userId}`);
  }

  private memberEntryRef(guildId: string, userId: string) {
    return this.db.collection("memberEntries").doc(`${guildId}_${userId}`);
  }

  private memberActionJobRef(id: string) {
    return this.db.collection("memberActionJobs").doc(id);
  }

  private hierarchyRoleRef(guildId: string, order: number) {
    return this.db.collection("hierarchyRoles").doc(`${guildId}_${order}`);
  }

  private memberPointEventRef() {
    return this.db.collection("memberPointEvents").doc();
  }

  private recruitmentConfigRef(guildId: string) {
    return this.db.collection("recruitmentConfigs").doc(guildId);
  }

  private recruitmentDraftRef(id: string) {
    return this.db.collection("recruitmentDrafts").doc(id);
  }

  private counterRef(name: string) {
    return this.db.collection("counters").doc(name);
  }

  private memberActionJobId(input: EnqueueMemberActionJobInput) {
    if (input.type === "approve_recruitment") {
      if (input.recruitmentId === null || input.recruitmentId === undefined) {
        throw new Error("approve_recruitment requer recruitmentId.");
      }
      return `approve_recruitment_${input.recruitmentId}`;
    }

    return `verify_member_${input.guildId}_${input.userId}`;
  }

  private async updateMemberEntry(
    guildId: string,
    userId: string,
    update: Partial<MemberEntryDocument>
  ): Promise<MemberEntry | null> {
    const ref = this.memberEntryRef(guildId, userId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      return null;
    }

    const updated: MemberEntryDocument = {
      ...(snapshot.data() as MemberEntryDocument),
      ...update,
      updatedAt: new Date().toISOString()
    };
    await ref.set(updated, { merge: true });
    return this.mapMemberEntry(updated);
  }

  private async updateMemberActionJobStatus(
    id: string,
    status: MemberActionJobStatus,
    error: string | null
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.memberActionJobRef(id).set({
      status,
      finishedAt: status === "completed" || status === "failed" || status === "cancelled" ? now : null,
      error,
      updatedAt: now
    }, { merge: true });
  }
}
