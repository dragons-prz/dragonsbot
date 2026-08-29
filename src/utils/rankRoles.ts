import { Guild } from "discord.js";

import { MemberProfile } from "../domain/types";
import { logger } from "./logger";

export interface RankSyncInput {
  member: MemberProfile;
  previousRankName: string;
  previousRankRoleId: string;
  rankChanged: boolean;
}

/**
 * Sincroniza o cargo de rank de um membro com a pontuacao que ele acabou de
 * ter alterada: tira o rank antigo, poe o novo e avisa por DM quando subiu.
 *
 * Extraido do job de aprovacao de recrutamento porque o comando manual de
 * pontos (`/pontos-dar`) precisa exatamente do mesmo comportamento — sem
 * isso, dar/tirar pontos na mao deixaria o cargo desalinhado da pontuacao.
 *
 * Nenhuma falha aqui derruba o fluxo chamador: cada operacao de cargo e
 * logada e engolida, porque os pontos ja foram gravados em transacao.
 */
export async function syncMemberRankRoles(
  guild: Guild,
  userId: string,
  result: RankSyncInput,
  logContext: Record<string, unknown> = {}
): Promise<void> {
  const { member: profile, rankChanged, previousRankName, previousRankRoleId } = result;
  const guildMember = await guild.members.fetch(userId).catch(() => null);
  if (!guildMember) {
    logger.warn("hierarchy.member_not_found", {
      guildId: guild.id,
      userId,
      rankName: profile.rankName,
      rankRoleId: profile.rankRoleId,
      ...logContext
    });
    return;
  }

  if (rankChanged) {
    const oldRank = await guild.roles.fetch(previousRankRoleId).catch(() => null);
    if (oldRank && guildMember.roles.cache.has(oldRank.id)) {
      await guildMember.roles.remove(oldRank, `Ajuste automatico para ${profile.rankName}`).catch((error) => {
        logger.error("hierarchy.old_rank_remove_failed", error, {
          guildId: guild.id,
          userId,
          userTag: guildMember.user.tag,
          oldRankRoleId: oldRank.id,
          ...logContext
        });
      });
    }
  }

  const currentRankRole = await guild.roles.fetch(profile.rankRoleId).catch(() => null);
  if (!currentRankRole) {
    logger.warn("hierarchy.rank_role_not_found", {
      guildId: guild.id,
      userId,
      rankName: profile.rankName,
      rankRoleId: profile.rankRoleId,
      ...logContext
    });
    return;
  }

  if (!guildMember.roles.cache.has(currentRankRole.id)) {
    await guildMember.roles.add(currentRankRole, `Sincronizacao automatica de rank ${profile.rankName}`).catch((error) => {
      logger.error("hierarchy.rank_role_add_failed", error, {
        guildId: guild.id,
        userId,
        userTag: guildMember.user.tag,
        rankName: profile.rankName,
        rankRoleId: profile.rankRoleId,
        ...logContext
      });
    });
  }

  if (!rankChanged) {
    return;
  }

  // So avisa quando subiu — perder pontos e rebaixar nao vira DM.
  const wentUp = profile.points > 0 && profile.rankRoleId !== previousRankRoleId;
  if (wentUp) {
    await guildMember.send(`Parabens! Voce upou para o cargo **${profile.rankName}**.`).catch((error) => {
      logger.error("hierarchy.rank_up_dm_failed", error, {
        guildId: guild.id,
        userId,
        userTag: guildMember.user.tag,
        rankName: profile.rankName,
        ...logContext
      });
    });
  }

  logger.info("hierarchy.rank_up", {
    guildId: guild.id,
    userId,
    userTag: guildMember.user.tag,
    previousRankName,
    previousRankRoleId,
    rankName: profile.rankName,
    rankRoleId: profile.rankRoleId,
    points: profile.points,
    ...logContext
  });
}
