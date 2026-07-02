import initSqlJs, { Database as SqlJsDatabase, Statement } from "sql.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ChannelConfigKey,
  CreateRecruitmentInput,
  DEFAULT_FOUNDER_ROLE_ID,
  DEFAULT_MEMBER_ROLE_ID,
  DEFAULT_RECRUITER_ROLE_ID,
  GuildConfig,
  ApprovedRecruitmentResult,
  Recruitment,
  RecruitmentApprovalMessage,
  RecruiterPoints,
  RecruiterRankingEntry,
  RecruiterStats,
  RoleConfigKey
} from "../../domain/types";
import { DragonsStore } from "../DragonsStore";

interface GuildConfigRow {
  guild_id: string;
  recruiter_role_id: string;
  founder_role_id: string;
  member_role_id: string;
  approval_channel_id: string | null;
}

interface RecruitmentRow {
  id: number;
  guild_id: string;
  recruit_user_id: string;
  recruiter_user_id: string;
  status: "pending" | "approved";
  approval_message_id: string | null;
  approved_by_user_id: string | null;
  created_at: string;
  approved_at: string | null;
}

interface RecruiterPointsRow {
  guild_id: string;
  recruiter_user_id: string;
  points: number;
}

interface CountRow {
  count: number;
}

interface RankingRow {
  recruiter_user_id: string;
  points: number;
  approved_recruitments: number;
}

interface ApprovalMessageRow {
  recruitment_id: number;
  founder_user_id: string;
  channel_id: string;
  message_id: string;
}

export class SqliteDragonsStore implements DragonsStore {
  private db: SqlJsDatabase | null = null;
  private readonly absolutePath: string;

  constructor(sqlitePath: string) {
    this.absolutePath = resolve(sqlitePath);
    mkdirSync(dirname(this.absolutePath), { recursive: true });
  }

  async init(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: (file) => join(process.cwd(), "node_modules", "sql.js", "dist", file)
    });

    this.db = existsSync(this.absolutePath)
      ? new SQL.Database(readFileSync(this.absolutePath))
      : new SQL.Database();

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guild_configs (
        guild_id TEXT PRIMARY KEY,
        recruiter_role_id TEXT NOT NULL,
        founder_role_id TEXT NOT NULL,
        member_role_id TEXT NOT NULL,
        approval_channel_id TEXT
      );

      CREATE TABLE IF NOT EXISTS recruitments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        recruit_user_id TEXT NOT NULL,
        recruiter_user_id TEXT NOT NULL,
        age INTEGER,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
        approval_message_id TEXT,
        approved_by_user_id TEXT,
        created_at TEXT NOT NULL,
        approved_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_recruitments_one_pending_per_user
        ON recruitments (guild_id, recruit_user_id)
        WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS recruiter_points (
        guild_id TEXT NOT NULL,
        recruiter_user_id TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, recruiter_user_id)
      );

      CREATE TABLE IF NOT EXISTS recruiter_point_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        recruiter_user_id TEXT NOT NULL,
        points INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recruitment_approval_messages (
        recruitment_id INTEGER NOT NULL,
        founder_user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        PRIMARY KEY (recruitment_id, founder_user_id)
      );
    `);
    this.persist();
  }

  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    this.persist();
    this.db.close();
    this.db = null;
  }

  async getGuildConfig(guildId: string): Promise<GuildConfig> {
    this.ensureGuildConfig(guildId);
    const row = this.getOne<GuildConfigRow>("SELECT * FROM guild_configs WHERE guild_id = ?", [guildId]);
    if (!row) {
      throw new Error("Falha ao carregar configuracao do servidor.");
    }

    return this.mapGuildConfig(row);
  }

  async setRoleConfig(guildId: string, key: RoleConfigKey, roleId: string): Promise<GuildConfig> {
    this.ensureGuildConfig(guildId);
    const columnByKey: Record<RoleConfigKey, keyof GuildConfigRow> = {
      recruiter: "recruiter_role_id",
      founder: "founder_role_id",
      member: "member_role_id"
    };

    this.database.run(`UPDATE guild_configs SET ${columnByKey[key]} = ? WHERE guild_id = ?`, [roleId, guildId]);
    this.persist();
    return this.getGuildConfig(guildId);
  }

  async setChannelConfig(guildId: string, key: ChannelConfigKey, channelId: string): Promise<GuildConfig> {
    this.ensureGuildConfig(guildId);
    if (key !== "approval") {
      throw new Error(`Canal de configuracao nao suportado: ${key}`);
    }

    this.database.run("UPDATE guild_configs SET approval_channel_id = ? WHERE guild_id = ?", [channelId, guildId]);
    this.persist();
    return this.getGuildConfig(guildId);
  }

  async createRecruitment(input: CreateRecruitmentInput): Promise<Recruitment> {
    const now = new Date().toISOString();
    this.database.run(
      `INSERT INTO recruitments (
        guild_id, recruit_user_id, recruiter_user_id, age, status, created_at
      ) VALUES (?, ?, ?, ?, 'pending', ?)`,
      [input.guildId, input.recruitUserId, input.recruiterUserId, 0, now]
    );
    this.persist();

    const recruitment = this.getOne<RecruitmentRow>(
      `SELECT * FROM recruitments
       WHERE guild_id = ? AND recruit_user_id = ? AND recruiter_user_id = ? AND created_at = ?
       ORDER BY id DESC
       LIMIT 1`,
      [input.guildId, input.recruitUserId, input.recruiterUserId, now]
    );
    if (!recruitment) {
      throw new Error("Falha ao recuperar recrutamento criado.");
    }

    return this.mapRecruitment(recruitment);
  }

  async getRecruitment(id: number): Promise<Recruitment | null> {
    const row = this.getOne<RecruitmentRow>("SELECT * FROM recruitments WHERE id = ?", [id]);
    return row ? this.mapRecruitment(row) : null;
  }

  async findPendingRecruitmentByUser(guildId: string, recruitUserId: string): Promise<Recruitment | null> {
    const row = this.getOne<RecruitmentRow>(
      "SELECT * FROM recruitments WHERE guild_id = ? AND recruit_user_id = ? AND status = 'pending'",
      [guildId, recruitUserId]
    );

    return row ? this.mapRecruitment(row) : null;
  }

  async setRecruitmentApprovalMessage(id: number, messageId: string): Promise<void> {
    this.database.run("UPDATE recruitments SET approval_message_id = ? WHERE id = ?", [messageId, id]);
    this.persist();
  }

  async addRecruitmentApprovalMessage(input: RecruitmentApprovalMessage): Promise<void> {
    this.database.run(
      `INSERT INTO recruitment_approval_messages (
        recruitment_id, founder_user_id, channel_id, message_id
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(recruitment_id, founder_user_id)
      DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
      [input.recruitmentId, input.founderUserId, input.channelId, input.messageId]
    );
    this.persist();
  }

  async getRecruitmentApprovalMessages(recruitmentId: number): Promise<RecruitmentApprovalMessage[]> {
    const rows = this.getAll<ApprovalMessageRow>(
      "SELECT * FROM recruitment_approval_messages WHERE recruitment_id = ?",
      [recruitmentId]
    );

    return rows.map((row) => ({
      recruitmentId: row.recruitment_id,
      founderUserId: row.founder_user_id,
      channelId: row.channel_id,
      messageId: row.message_id
    }));
  }

  async deletePendingRecruitment(id: number): Promise<void> {
    this.database.run("DELETE FROM recruitment_approval_messages WHERE recruitment_id = ?", [id]);
    this.database.run("DELETE FROM recruitments WHERE id = ? AND status = 'pending'", [id]);
    this.persist();
  }

  async approveRecruitment(id: number, approvedByUserId: string): Promise<Recruitment | null> {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE recruitments
       SET status = 'approved', approved_by_user_id = ?, approved_at = ?
       WHERE id = ? AND status = 'pending'`,
      [approvedByUserId, now, id]
    );
    const changes = this.database.getRowsModified();
    this.persist();

    if (changes === 0) {
      return null;
    }

    return this.getRecruitment(id);
  }

  async approveRecruitmentAndAddPoints(
    id: number,
    approvedByUserId: string,
    points: number,
    reason: string
  ): Promise<ApprovedRecruitmentResult | null> {
    const now = new Date().toISOString();
    this.database.run("BEGIN TRANSACTION");
    try {
      this.database.run(
        `UPDATE recruitments
         SET status = 'approved', approved_by_user_id = ?, approved_at = ?
         WHERE id = ? AND status = 'pending'`,
        [approvedByUserId, now, id]
      );

      if (this.database.getRowsModified() === 0) {
        this.database.run("ROLLBACK");
        return null;
      }

      const recruitmentRow = this.getOne<RecruitmentRow>("SELECT * FROM recruitments WHERE id = ?", [id]);
      if (!recruitmentRow) {
        this.database.run("ROLLBACK");
        throw new Error("Falha ao recuperar recrutamento aprovado.");
      }

      const recruitment = this.mapRecruitment(recruitmentRow);
      this.database.run(
        `INSERT INTO recruiter_points (guild_id, recruiter_user_id, points)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id, recruiter_user_id)
         DO UPDATE SET points = points + excluded.points`,
        [recruitment.guildId, recruitment.recruiterUserId, points]
      );

      this.database.run(
        `INSERT INTO recruiter_point_events (guild_id, recruiter_user_id, points, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [recruitment.guildId, recruitment.recruiterUserId, points, reason, now]
      );

      this.database.run("COMMIT");
      this.persist();

      return {
        recruitment,
        recruiterPoints: await this.getRecruiterPoints(recruitment.guildId, recruitment.recruiterUserId)
      };
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }
  }

  async addRecruiterPoints(
    guildId: string,
    recruiterUserId: string,
    points: number,
    reason: string
  ): Promise<RecruiterPoints> {
    this.database.run("BEGIN TRANSACTION");
    try {
      this.database.run(
        `INSERT INTO recruiter_points (guild_id, recruiter_user_id, points)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id, recruiter_user_id)
         DO UPDATE SET points = points + excluded.points`,
        [guildId, recruiterUserId, points]
      );

      this.database.run(
        `INSERT INTO recruiter_point_events (guild_id, recruiter_user_id, points, reason, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [guildId, recruiterUserId, points, reason, new Date().toISOString()]
      );
      this.database.run("COMMIT");
      this.persist();
    } catch (error) {
      this.database.run("ROLLBACK");
      throw error;
    }

    return this.getRecruiterPoints(guildId, recruiterUserId);
  }

  async getRecruiterPoints(guildId: string, recruiterUserId: string): Promise<RecruiterPoints> {
    const row = this.getOne<RecruiterPointsRow>(
      "SELECT * FROM recruiter_points WHERE guild_id = ? AND recruiter_user_id = ?",
      [guildId, recruiterUserId]
    );

    return {
      guildId,
      recruiterUserId,
      points: row?.points ?? 0
    };
  }

  async getRecruiterStats(guildId: string, recruiterUserId: string): Promise<RecruiterStats> {
    const points = await this.getRecruiterPoints(guildId, recruiterUserId);
    const count = this.getOne<CountRow>(
      `SELECT COUNT(*) AS count
       FROM recruitments
       WHERE guild_id = ? AND recruiter_user_id = ? AND status = 'approved'`,
      [guildId, recruiterUserId]
    );

    return {
      guildId,
      recruiterUserId,
      points: points.points,
      approvedRecruitments: count?.count ?? 0
    };
  }

  async getRecruiterRanking(guildId: string, limit: number): Promise<RecruiterRankingEntry[]> {
    const safeLimit = Math.max(1, Math.min(limit, 25));
    const rows = this.getAll<RankingRow>(
      `SELECT
         rp.recruiter_user_id,
         rp.points,
         COUNT(r.id) AS approved_recruitments
       FROM recruiter_points rp
       LEFT JOIN recruitments r
         ON r.guild_id = rp.guild_id
        AND r.recruiter_user_id = rp.recruiter_user_id
        AND r.status = 'approved'
       WHERE rp.guild_id = ?
       GROUP BY rp.guild_id, rp.recruiter_user_id, rp.points
       ORDER BY rp.points DESC, approved_recruitments DESC, rp.recruiter_user_id ASC
       LIMIT ?`,
      [guildId, safeLimit]
    );

    return rows.map((row, index) => ({
      position: index + 1,
      guildId,
      recruiterUserId: row.recruiter_user_id,
      points: row.points,
      approvedRecruitments: row.approved_recruitments
    }));
  }

  private ensureGuildConfig(guildId: string): void {
    this.database.run(
      `INSERT OR IGNORE INTO guild_configs (
        guild_id, recruiter_role_id, founder_role_id, member_role_id, approval_channel_id
      ) VALUES (?, ?, ?, ?, NULL)`,
      [guildId, DEFAULT_RECRUITER_ROLE_ID, DEFAULT_FOUNDER_ROLE_ID, DEFAULT_MEMBER_ROLE_ID]
    );
    this.persist();
  }

  private mapGuildConfig(row: GuildConfigRow): GuildConfig {
    return {
      guildId: row.guild_id,
      recruiterRoleId: row.recruiter_role_id,
      founderRoleId: row.founder_role_id,
      memberRoleId: row.member_role_id,
      approvalChannelId: row.approval_channel_id
    };
  }

  private mapRecruitment(row: RecruitmentRow): Recruitment {
    return {
      id: row.id,
      guildId: row.guild_id,
      recruitUserId: row.recruit_user_id,
      recruiterUserId: row.recruiter_user_id,
      status: row.status,
      approvalMessageId: row.approval_message_id,
      approvedByUserId: row.approved_by_user_id,
      createdAt: row.created_at,
      approvedAt: row.approved_at
    };
  }

  private get database(): SqlJsDatabase {
    if (!this.db) {
      throw new Error("Banco SQLite nao inicializado.");
    }

    return this.db;
  }

  private getOne<T>(sql: string, params: (string | number | null)[]): T | null {
    const statement = this.database.prepare(sql);
    try {
      statement.bind(params);
      if (!statement.step()) {
        return null;
      }

      return this.normalizeRow<T>(statement);
    } finally {
      statement.free();
    }
  }

  private getAll<T>(sql: string, params: (string | number | null)[]): T[] {
    const statement = this.database.prepare(sql);
    const rows: T[] = [];
    try {
      statement.bind(params);
      while (statement.step()) {
        rows.push(this.normalizeRow<T>(statement));
      }

      return rows;
    } finally {
      statement.free();
    }
  }

  private normalizeRow<T>(statement: Statement): T {
    const row = statement.getAsObject() as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = value === undefined ? null : value;
    }

    return normalized as T;
  }

  private persist(): void {
    if (!this.db) {
      return;
    }

    writeFileSync(this.absolutePath, Buffer.from(this.db.export()));
  }
}
