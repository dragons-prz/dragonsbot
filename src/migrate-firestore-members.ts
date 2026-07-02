import { getFirestore } from "firebase-admin/firestore";
import { HIERARCHY_ROLES } from "./domain/types";
import { loadEnv } from "./config/env";
import { FirestoreDragonsStore } from "./storage/firestore/FirestoreDragonsStore";

interface LegacyRecruiterPointsDocument {
  guildId: string;
  recruiterUserId: string;
  points: number;
}

interface LegacyPointEventDocument {
  guildId: string;
  recruiterUserId: string;
  points: number;
  reason: string;
  createdAt: string;
  createdAtTimestamp?: unknown;
}

function rankForPoints(points: number) {
  return [...HIERARCHY_ROLES].reverse().find((rank) => points >= rank.points) ?? HIERARCHY_ROLES[0];
}

async function main(): Promise<void> {
  const env = loadEnv();
  new FirestoreDragonsStore(env);
  const db = getFirestore();
  const now = new Date().toISOString();

  const legacyPoints = await db.collection("recruiterPoints").get();
  const batch = db.batch();
  let memberCount = 0;

  for (const doc of legacyPoints.docs) {
    const data = doc.data() as LegacyRecruiterPointsDocument;
    const recruitments = await db
      .collection("recruitments")
      .where("guildId", "==", data.guildId)
      .where("recruiterUserId", "==", data.recruiterUserId)
      .where("status", "==", "approved")
      .get();
    const rank = rankForPoints(data.points);

    batch.set(
      db.collection("members").doc(`${data.guildId}_${data.recruiterUserId}`),
      {
        guildId: data.guildId,
        userId: data.recruiterUserId,
        points: data.points,
        recruitments: recruitments.size,
        rankName: rank.name,
        rankRoleId: rank.roleId,
        updatedAt: now
      },
      { merge: true }
    );
    memberCount += 1;
  }

  const legacyEvents = await db.collection("recruiterPointEvents").get();
  let eventCount = 0;
  for (const doc of legacyEvents.docs) {
    const data = doc.data() as LegacyPointEventDocument;
    const eventData: Record<string, unknown> = {
      guildId: data.guildId,
      userId: data.recruiterUserId,
      points: data.points,
      reason: data.reason,
      source: "legacy_recruitment",
      createdAt: data.createdAt
    };
    if (data.createdAtTimestamp) {
      eventData.createdAtTimestamp = data.createdAtTimestamp;
    }

    batch.set(
      db.collection("memberPointEvents").doc(doc.id),
      eventData,
      { merge: true }
    );
    eventCount += 1;
  }

  await batch.commit();
  console.log(`Membros migrados: ${memberCount}`);
  console.log(`Eventos migrados: ${eventCount}`);
}

main().catch((error) => {
  console.error("Falha ao migrar membros:", error);
  process.exit(1);
});
