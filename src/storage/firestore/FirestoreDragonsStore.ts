import { cert, getApps, initializeApp, ServiceAccount } from "firebase-admin/app";
import { FieldValue, Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { AppEnv } from "../../config/env";
import {
  ApprovedRecruitmentResult,
  ChannelConfigKey,
  CreateRecruitmentInput,
  DEFAULT_FOUNDER_ROLE_ID,
  DEFAULT_MEMBER_ROLE_ID,
  DEFAULT_RECRUITER_ROLE_ID,
  GuildConfig,
  Recruitment,
  RecruitmentApprovalMessage,
  RecruiterPoints,
  RecruiterRankingEntry,
  RecruiterStats,
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

interface RecruiterPointsDocument {
  guildId: string;
  recruiterUserId: string;
  points: number;
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

  async approveRecruitmentAndAddPoints(
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
      const pointsRef = this.recruiterPointsRef(updatedRecruitment.guildId, updatedRecruitment.recruiterUserId);
      const pointsSnapshot = await transaction.get(pointsRef);
      const currentPoints = (pointsSnapshot.data()?.points as number | undefined) ?? 0;
      const nextPoints = currentPoints + points;

      transaction.update(recruitmentRef, {
        status: "approved",
        approvedByUserId,
        approvedAt: now
      });
      transaction.set(pointsRef, {
        guildId: updatedRecruitment.guildId,
        recruiterUserId: updatedRecruitment.recruiterUserId,
        points: nextPoints
      });
      transaction.create(this.pointEventRef(), {
        guildId: updatedRecruitment.guildId,
        recruiterUserId: updatedRecruitment.recruiterUserId,
        points,
        reason,
        createdAt: now,
        createdAtTimestamp: Timestamp.now()
      });

      return {
        recruitment: this.mapRecruitment(updatedRecruitment),
        recruiterPoints: {
          guildId: updatedRecruitment.guildId,
          recruiterUserId: updatedRecruitment.recruiterUserId,
          points: nextPoints
        }
      };
    });
  }

  async addRecruiterPoints(
    guildId: string,
    recruiterUserId: string,
    points: number,
    reason: string
  ): Promise<RecruiterPoints> {
    const now = new Date().toISOString();
    return this.db.runTransaction(async (transaction) => {
      const pointsRef = this.recruiterPointsRef(guildId, recruiterUserId);
      const snapshot = await transaction.get(pointsRef);
      const nextPoints = ((snapshot.data()?.points as number | undefined) ?? 0) + points;

      transaction.set(pointsRef, { guildId, recruiterUserId, points: nextPoints });
      transaction.create(this.pointEventRef(), {
        guildId,
        recruiterUserId,
        points,
        reason,
        createdAt: now,
        createdAtTimestamp: Timestamp.now()
      });

      return { guildId, recruiterUserId, points: nextPoints };
    });
  }

  async getRecruiterPoints(guildId: string, recruiterUserId: string): Promise<RecruiterPoints> {
    const snapshot = await this.recruiterPointsRef(guildId, recruiterUserId).get();
    return {
      guildId,
      recruiterUserId,
      points: (snapshot.data()?.points as number | undefined) ?? 0
    };
  }

  async getRecruiterStats(guildId: string, recruiterUserId: string): Promise<RecruiterStats> {
    const [points, recruitments] = await Promise.all([
      this.getRecruiterPoints(guildId, recruiterUserId),
      this.db
        .collection("recruitments")
        .where("guildId", "==", guildId)
        .where("recruiterUserId", "==", recruiterUserId)
        .where("status", "==", "approved")
        .get()
    ]);

    return {
      guildId,
      recruiterUserId,
      points: points.points,
      approvedRecruitments: recruitments.size
    };
  }

  async getRecruiterRanking(guildId: string, limit: number): Promise<RecruiterRankingEntry[]> {
    const safeLimit = Math.max(1, Math.min(limit, 25));
    const snapshot = await this.db
      .collection("recruiterPoints")
      .where("guildId", "==", guildId)
      .get();

    const entries = await Promise.all(
      snapshot.docs.map(async (doc, index) => {
        const data = doc.data() as RecruiterPointsDocument;
        const stats = await this.getRecruiterStats(guildId, data.recruiterUserId);
        return {
          position: index + 1,
          guildId,
          recruiterUserId: data.recruiterUserId,
          points: data.points,
          approvedRecruitments: stats.approvedRecruitments
        };
      })
    );

    return entries.sort((a, b) => b.points - a.points || b.approvedRecruitments - a.approvedRecruitments || a.recruiterUserId.localeCompare(b.recruiterUserId))
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

  private guildConfigRef(guildId: string) {
    return this.db.collection("guildConfigs").doc(guildId);
  }

  private recruitmentRef(id: number) {
    return this.db.collection("recruitments").doc(String(id));
  }

  private approvalMessageRef(recruitmentId: number, founderUserId: string) {
    return this.recruitmentRef(recruitmentId).collection("approvalMessages").doc(founderUserId);
  }

  private recruiterPointsRef(guildId: string, recruiterUserId: string) {
    return this.db.collection("recruiterPoints").doc(`${guildId}_${recruiterUserId}`);
  }

  private pointEventRef() {
    return this.db.collection("recruiterPointEvents").doc();
  }

  private counterRef(name: string) {
    return this.db.collection("counters").doc(name);
  }
}
