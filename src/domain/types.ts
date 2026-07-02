export const DEFAULT_RECRUITER_ROLE_ID = "1520118976087199754";
export const DEFAULT_FOUNDER_ROLE_ID = "1487882833761407007";
export const DEFAULT_MEMBER_ROLE_ID = "1487825181337587822";
export const RECRUITMENT_POINTS = 8;
export const HIERARCHY_ROLES = [
  { name: "Delusions", roleId: "1487888136598982838", points: 0, recruitments: 0 },
  { name: "Hope", roleId: "1488087958249799850", points: 24, recruitments: 3 },
  { name: "Lotus", roleId: "1488086603980214433", points: 56, recruitments: 7 },
  { name: "Swag", roleId: "1488087908480057354", points: 96, recruitments: 12 },
  { name: "Revenge", roleId: "1488086779532939284", points: 144, recruitments: 18 },
  { name: "Mystic", roleId: "1488086653359882271", points: 200, recruitments: 25 },
  { name: "Darkness", roleId: "1488086711278764213", points: 264, recruitments: 33 },
  { name: "Death", roleId: "1487888101245325552", points: 336, recruitments: 42 },
  { name: "Nightmare", roleId: "1487888057901518849", points: 416, recruitments: 52 },
  { name: "Critic", roleId: "1487887943103283240", points: 504, recruitments: 63 },
  { name: "Prince Of Chaos", roleId: "1487888006345003058", points: 600, recruitments: 75 },
  { name: "Legend", roleId: "1488088043133865994", points: 704, recruitments: 88 },
  { name: "Supreme", roleId: "1488088157625909269", points: 816, recruitments: 102 },
  { name: "Insanity", roleId: "1488088110599503903", points: 936, recruitments: 117 },
  { name: "Royal", roleId: "1487887769182142514", points: 1064, recruitments: 133 },
  { name: "Imperial", roleId: "1487887706015928455", points: 1200, recruitments: 150 },
  { name: "Destiny", roleId: "1487884344872927365", points: 1360, recruitments: 170 },
  { name: "Eternal", roleId: "1488088203436097566", points: 1536, recruitments: 192 },
  { name: "Immortal", roleId: "1487887891676926032", points: 1728, recruitments: 216 },
  { name: "Angelical", roleId: "1487887828523417611", points: 1920, recruitments: 240 },
  { name: "God", roleId: "1488086504202043502", points: 2160, recruitments: 270 }
] as const;

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

export interface CreateRecruitmentInput {
  guildId: string;
  recruitUserId: string;
  recruiterUserId: string;
}
