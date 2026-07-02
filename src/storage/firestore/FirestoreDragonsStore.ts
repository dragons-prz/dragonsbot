import { cert, getApps, initializeApp, ServiceAccount } from "firebase-admin/app";
import { Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { AppEnv } from "../../config/env";
import {
  ApprovedRecruitmentResult,
  ChannelConfigKey,
  CreateRecruitmentInput,
  DEFAULT_FOUNDER_ROLE_ID,
  DEFAULT_MEMBER_ROLE_ID,
  DEFAULT_RECRUITER_ROLE_ID,
  HIERARCHY_ROLES,
  GuildConfig,
  MemberProfile,
  MemberRankingEntry,
  Recruitment,
  RecruitmentApprovalMessage,
  RoleConfigKey
} from "../../domain/types";
import { DragonsStore } from "../DragonsStore";

interface GuildConfigDocument {
  recruiterRoleId: string;
  founderRoleId: string;
  memberRoleId: string;
  approvalChannelId: string | null;
}

interface RecruitmentDocument {
  id: number;
  guildId: string;
  recruitUserId: string;
  recruiterUserId: string;
  status: "pending" | "approved";
  approvalMessageId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
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
      return this.mapGuildConfig(guildId, defaults);
    }

    return this.mapGuildConfig(guildId, snapshot.data() as GuildConfigDocument);
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
    if (key !== "approval") {
      throw new Error(`Canal de configuracao nao suportado: ${key}`);
    }

    await this.ensureGuildConfig(guildId);
    await this.guildConfigRef(guildId).update({ approvalChannelId: channelId });
    return this.getGuildConfig(guildId);
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
      const currentMember = this.mapMemberFromSnapshot(
        updatedRecruitment.guildId,
        updatedRecruitment.recruiterUserId,
        memberSnapshot.data() as MemberDocument | undefined
      );
      const previousRankName = currentMember.rankName;
      const previousRankRoleId = currentMember.rankRoleId;
      const nextPoints = currentMember.points + points;
      const nextRecruitments = currentMember.recruitments + 1;
      const nextRank = this.getRankForPoints(nextPoints);
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
      const currentMember = this.mapMemberFromSnapshot(guildId, userId, snapshot.data() as MemberDocument | undefined);
      const nextPoints = currentMember.points + points;
      const nextRank = this.getRankForPoints(nextPoints);
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

  async ensureMemberProfile(guildId: string, userId: string): Promise<MemberProfile> {
    const now = new Date().toISOString();
    const ref = this.memberRef(guildId, userId);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      return this.mapMemberFromSnapshot(guildId, userId, snapshot.data() as MemberDocument);
    }

    const baseRank = this.getRankForPoints(0);
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
    return profile;
  }

  async getMemberProfile(guildId: string, userId: string): Promise<MemberProfile> {
    const snapshot = await this.memberRef(guildId, userId).get();
    return this.mapMemberFromSnapshot(guildId, userId, snapshot.data() as MemberDocument | undefined);
  }

  async getMemberRanking(guildId: string, limit: number): Promise<MemberRankingEntry[]> {
    const safeLimit = Math.max(1, Math.min(limit, 25));
    const snapshot = await this.db
      .collection("members")
      .where("guildId", "==", guildId)
      .get();

    return snapshot.docs
      .map((doc, index) => ({
        position: index + 1,
        ...this.mapMemberFromSnapshot(guildId, doc.id.split("_").slice(1).join("_"), doc.data() as MemberDocument)
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
      approvalChannelId: null
    };
  }

  private mapGuildConfig(guildId: string, data: GuildConfigDocument): GuildConfig {
    return {
      guildId,
      recruiterRoleId: data.recruiterRoleId,
      founderRoleId: data.founderRoleId,
      memberRoleId: data.memberRoleId,
      approvalChannelId: data.approvalChannelId ?? null
    };
  }

  private mapRecruitment(data: RecruitmentDocument): Recruitment {
    return {
      id: data.id,
      guildId: data.guildId,
      recruitUserId: data.recruitUserId,
      recruiterUserId: data.recruiterUserId,
      status: data.status,
      approvalMessageId: data.approvalMessageId,
      approvedByUserId: data.approvedByUserId,
      createdAt: data.createdAt,
      approvedAt: data.approvedAt
    };
  }

  private mapMemberFromSnapshot(guildId: string, userId: string, data?: Partial<MemberDocument>): MemberProfile {
    const points = data?.points ?? 0;
    const rank = this.getRankForPoints(points);
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

  private getRankForPoints(points: number) {
    return [...HIERARCHY_ROLES].reverse().find((rank) => points >= rank.points) ?? HIERARCHY_ROLES[0];
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

  private memberPointEventRef() {
    return this.db.collection("memberPointEvents").doc();
  }

  private counterRef(name: string) {
    return this.db.collection("counters").doc(name);
  }
}
