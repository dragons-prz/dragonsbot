import {
  ChannelConfigKey,
  CreateRecruitmentInput,
  GuildConfig,
  ApprovedRecruitmentResult,
  MemberProfile,
  MemberRankingEntry,
  Recruitment,
  RecruitmentApprovalMessage,
  RoleConfigKey
} from "../domain/types";

export interface DragonsStore {
  init(): Promise<void>;
  close(): Promise<void>;

  getGuildConfig(guildId: string): Promise<GuildConfig>;
  setRoleConfig(guildId: string, key: RoleConfigKey, roleId: string): Promise<GuildConfig>;
  setChannelConfig(guildId: string, key: ChannelConfigKey, channelId: string): Promise<GuildConfig>;

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
  ensureMemberProfile(guildId: string, userId: string): Promise<MemberProfile>;
  getMemberProfile(guildId: string, userId: string): Promise<MemberProfile>;
  getMemberRanking(guildId: string, limit: number): Promise<MemberRankingEntry[]>;
}
