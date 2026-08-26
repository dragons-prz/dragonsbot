import {
  ChannelConfigKey,
  CreateMemberEntryInput,
  CreateRecruitmentInput,
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
}
