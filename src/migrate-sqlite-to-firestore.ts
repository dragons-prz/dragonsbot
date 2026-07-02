import initSqlJs, { Database, Statement } from "sql.js";
import { getFirestore } from "firebase-admin/firestore";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnv } from "./config/env";
import { FirestoreDragonsStore } from "./storage/firestore/FirestoreDragonsStore";

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

interface RecruiterPointEventRow {
  id: number;
  guild_id: string;
  recruiter_user_id: string;
  points: number;
  reason: string;
  created_at: string;
}

interface ApprovalMessageRow {
  recruitment_id: number;
  founder_user_id: string;
  channel_id: string;
  message_id: string;
}

function getAll<T>(db: Database, sql: string): T[] {
  const statement = db.prepare(sql);
  const rows: T[] = [];
  try {
    while (statement.step()) {
      rows.push(normalizeRow<T>(statement));
    }
    return rows;
  } finally {
    statement.free();
  }
}

function tableExists(db: Database, tableName: string): boolean {
  const statement = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
  try {
    statement.bind([tableName]);
    return statement.step();
  } finally {
    statement.free();
  }
}

function getTableRows<T>(db: Database, tableName: string, sql: string): T[] {
  return tableExists(db, tableName) ? getAll<T>(db, sql) : [];
}

function normalizeRow<T>(statement: Statement): T {
  const row = statement.getAsObject() as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = value === undefined ? null : value;
  }
  return normalized as T;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const sqlitePath = resolve(env.sqlitePath);
  if (!existsSync(sqlitePath)) {
    throw new Error(`Arquivo SQLite nao encontrado: ${sqlitePath}`);
  }

  new FirestoreDragonsStore({ ...env, databaseProvider: "firestore" });
  const firestore = getFirestore();
  const SQL = await initSqlJs({
    locateFile: (file) => join(process.cwd(), "node_modules", "sql.js", "dist", file)
  });
  const sqlite = new SQL.Database(readFileSync(sqlitePath));

  try {
    const guildConfigs = getTableRows<GuildConfigRow>(sqlite, "guild_configs", "SELECT * FROM guild_configs");
    const recruitments = getTableRows<RecruitmentRow>(sqlite, "recruitments", "SELECT * FROM recruitments");
    const recruiterPoints = getTableRows<RecruiterPointsRow>(sqlite, "recruiter_points", "SELECT * FROM recruiter_points");
    const pointEvents = getTableRows<RecruiterPointEventRow>(sqlite, "recruiter_point_events", "SELECT * FROM recruiter_point_events");
    const approvalMessages = getTableRows<ApprovalMessageRow>(
      sqlite,
      "recruitment_approval_messages",
      "SELECT * FROM recruitment_approval_messages"
    );

    let batch = firestore.batch();
    let operations = 0;
    const commitIfNeeded = async () => {
      if (operations < 450) {
        return;
      }
      await batch.commit();
      batch = firestore.batch();
      operations = 0;
    };
    const set = async (path: string, data: Record<string, unknown>) => {
      batch.set(firestore.doc(path), data, { merge: true });
      operations += 1;
      await commitIfNeeded();
    };

    for (const row of guildConfigs) {
      await set(`guildConfigs/${row.guild_id}`, {
        recruiterRoleId: row.recruiter_role_id,
        founderRoleId: row.founder_role_id,
        memberRoleId: row.member_role_id,
        approvalChannelId: row.approval_channel_id
      });
    }

    for (const row of recruitments) {
      await set(`recruitments/${row.id}`, {
        id: row.id,
        guildId: row.guild_id,
        recruitUserId: row.recruit_user_id,
        recruiterUserId: row.recruiter_user_id,
        status: row.status,
        approvalMessageId: row.approval_message_id,
        approvedByUserId: row.approved_by_user_id,
        createdAt: row.created_at,
        approvedAt: row.approved_at
      });
    }

    for (const row of recruiterPoints) {
      await set(`recruiterPoints/${row.guild_id}_${row.recruiter_user_id}`, {
        guildId: row.guild_id,
        recruiterUserId: row.recruiter_user_id,
        points: row.points
      });
    }

    for (const row of pointEvents) {
      await set(`recruiterPointEvents/${row.id}`, {
        guildId: row.guild_id,
        recruiterUserId: row.recruiter_user_id,
        points: row.points,
        reason: row.reason,
        createdAt: row.created_at
      });
    }

    for (const row of approvalMessages) {
      await set(`recruitments/${row.recruitment_id}/approvalMessages/${row.founder_user_id}`, {
        founderUserId: row.founder_user_id,
        channelId: row.channel_id,
        messageId: row.message_id
      });
    }

    const nextRecruitmentId = recruitments.reduce((max, row) => Math.max(max, row.id), 0) + 1;
    await set("counters/recruitments", { nextId: nextRecruitmentId });

    if (operations > 0) {
      await batch.commit();
    }

    console.log("Migracao SQLite -> Firestore concluida.");
    console.log(`guildConfigs: ${guildConfigs.length}`);
    console.log(`recruitments: ${recruitments.length}`);
    console.log(`recruiterPoints: ${recruiterPoints.length}`);
    console.log(`recruiterPointEvents: ${pointEvents.length}`);
    console.log(`approvalMessages: ${approvalMessages.length}`);
    console.log(`proximo recruitment id: ${nextRecruitmentId}`);
  } finally {
    sqlite.close();
  }
}

main().catch((error) => {
  console.error("Falha na migracao:", error);
  process.exit(1);
});
