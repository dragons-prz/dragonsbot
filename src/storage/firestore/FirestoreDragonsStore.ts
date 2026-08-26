import { cert, getApps, initializeApp, ServiceAccount } from "firebase-admin/app";
import { Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { AppEnv } from "../../config/env";
import { logger } from "../../utils/logger";
import {
  ApprovedRecruitmentResult,
  ChannelConfigKey,
  CreateMemberEntryInput,
  CreateRecruitmentInput,
  EnqueueMemberActionJobInput,
  EnqueueMemberActionJobResult,
  DEFAULT_HIERARCHY_ROLES,
  DEFAULT_FOUNDER_ROLE_ID,
  DEFAULT_MEMBER_ROLE_ID,
  DEFAULT_RECRUITER_ROLE_ID,
  DEFAULT_RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID,
  GuildConfig,
  HierarchyRole,
  MemberActionJob,
  MemberActionJobStatus,
  MemberActionJobType,
  MemberEntry,
  MemberEntryStatus,
  MemberProfile,
  MemberProfileResult,
  MemberRankingEntry,
  Recruitment,
  RecruitmentKind,
  RecruitmentApprovalMessage,
  RoleConfigKey
} from "../../domain/types";
import { DragonsStore } from "../DragonsStore";

interface GuildConfigDocument {
  recruiterRoleId: string;
  founderRoleId: string;
  memberRoleId: string;
  approvalChannelId: string | null;
  recruitmentAnnouncementChannelId?: string;
  hierarchySeeded?: boolean;
}

interface RecruitmentDocument {
  id: number;
  guildId: string;
  recruitUserId: string;
  recruiterUserId: string;
  kind?: RecruitmentKind;
  status: "pending" | "approved";
  approvalMessageId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
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
    if (key !== "approval" && key !== "recruitment") {
      throw new Error(`Canal de configuracao nao suportado: ${key}`);
    }

    await this.ensureGuildConfig(guildId);
    const field = key === "approval" ? "approvalChannelId" : "recruitmentAnnouncementChannelId";
    await this.guildConfigRef(guildId).update({ [field]: channelId });
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
        approvedAt: null
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
      approvedAt: data.approvedAt
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
