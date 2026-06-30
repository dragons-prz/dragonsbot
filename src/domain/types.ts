export const DEFAULT_RECRUITER_ROLE_ID = "1520118976087199754";
export const DEFAULT_FOUNDER_ROLE_ID = "1487882833761407007";
export const DEFAULT_MEMBER_ROLE_ID = "1487825181337587822";
export const RECRUITMENT_POINTS = 8;

export type RoleConfigKey = "recruiter" | "founder" | "member";
export type ChannelConfigKey = "approval";
export type RecruitmentStatus = "pending" | "approved";

export interface GuildConfig {
  guildId: string;
  recruiterRoleId: string;
  founderRoleId: string;
  memberRoleId: string;
  approvalChannelId: string | null;
}

export interface Recruitment {
  id: number;
  guildId: string;
  recruitUserId: string;
  recruiterUserId: string;
  status: RecruitmentStatus;
  approvalMessageId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export interface RecruiterPoints {
  guildId: string;
  recruiterUserId: string;
  points: number;
}

export interface RecruiterStats {
  guildId: string;
  recruiterUserId: string;
  points: number;
  approvedRecruitments: number;
}

export interface RecruiterRankingEntry extends RecruiterStats {
  position: number;
}

export interface RecruitmentApprovalMessage {
  recruitmentId: number;
  founderUserId: string;
  channelId: string;
  messageId: string;
}

export interface CreateRecruitmentInput {
  guildId: string;
  recruitUserId: string;
  recruiterUserId: string;
}
