import {
  ChannelConfigKey,
  CreateRecruitmentInput,
  GuildConfig,
  Recruitment,
  RecruiterPoints,
  RecruiterRankingEntry,
  RecruiterStats,
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
  deletePendingRecruitment(id: number): Promise<void>;
  approveRecruitment(id: number, approvedByUserId: string): Promise<Recruitment | null>;

  addRecruiterPoints(guildId: string, recruiterUserId: string, points: number, reason: string): Promise<RecruiterPoints>;
  getRecruiterPoints(guildId: string, recruiterUserId: string): Promise<RecruiterPoints>;
  getRecruiterStats(guildId: string, recruiterUserId: string): Promise<RecruiterStats>;
  getRecruiterRanking(guildId: string, limit: number): Promise<RecruiterRankingEntry[]>;
}
