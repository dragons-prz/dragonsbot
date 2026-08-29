import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { getGuildId, memberHasAnyRole, requireGuildMember } from "../utils/discord";
import { logger } from "../utils/logger";
import { syncMemberRankRoles } from "../utils/rankRoles";
import { SlashCommand } from "./types";

/**
 * Concessao manual de pontos. Quem pode usar e definido no painel
 * (`pointsGrantRoleIds`), nao por permissao do Discord — a gestao muda de
 * cargo com mais frequencia do que dava para acompanhar por codigo.
 *
 * Aceita valor negativo (remocao), limitado por `minManualPoints`/
 * `maxManualPoints`. Depois de gravar, sincroniza o cargo de rank: sem isso,
 * mexer nos pontos na mao deixaria o cargo desalinhado da pontuacao.
 */
export const pontosDarCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("pontos-dar")
    .setDescription("Da ou remove pontos de um membro manualmente.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Membro que recebe os pontos.").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("quantidade")
        .setDescription("Pontos a somar (use valor negativo para remover).")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("motivo").setDescription("Motivo do ajuste.").setRequired(true)
    ),

  async execute(interaction, { store }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = getGuildId(interaction);
    const granter = requireGuildMember(interaction);
    const flowConfig = await store.getRecruitmentFlowConfig(guildId);

    if (!memberHasAnyRole(granter, flowConfig.pointsGrantRoleIds)) {
      logger.warn("points.grant_blocked", {
        reason: "missing_grant_role",
        guildId,
        granterUserId: granter.id,
        granterUserTag: granter.user.tag,
        allowedRoleIds: flowConfig.pointsGrantRoleIds
      });
      await interaction.editReply(flowConfig.notApproverMessage);
      return;
    }

    const targetUser = interaction.options.getUser("usuario", true);
    const amount = interaction.options.getInteger("quantidade", true);
    const reason = interaction.options.getString("motivo", true);

    if (amount === 0) {
      await interaction.editReply("A quantidade precisa ser diferente de zero.");
      return;
    }

    if (amount < flowConfig.minManualPoints || amount > flowConfig.maxManualPoints) {
      logger.warn("points.grant_blocked", {
        reason: "amount_out_of_range",
        guildId,
        granterUserId: granter.id,
        targetUserId: targetUser.id,
        amount,
        minManualPoints: flowConfig.minManualPoints,
        maxManualPoints: flowConfig.maxManualPoints
      });
      await interaction.editReply(
        `A quantidade precisa ficar entre ${flowConfig.minManualPoints} e ${flowConfig.maxManualPoints} pontos.`
      );
      return;
    }

    const targetMember = await interaction.guild!.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.editReply("O usuario informado nao esta no servidor.");
      return;
    }

    const { profile: before } = await store.getMemberProfile(guildId, targetUser.id);
    const after = await store.addMemberPoints(guildId, targetUser.id, amount, reason);

    await syncMemberRankRoles(
      interaction.guild!,
      targetUser.id,
      {
        member: after,
        previousRankName: before.rankName,
        previousRankRoleId: before.rankRoleId,
        rankChanged: before.rankRoleId !== after.rankRoleId
      },
      { source: "manual_grant", granterUserId: granter.id }
    );

    logger.info("points.granted_manual", {
      guildId,
      granterUserId: granter.id,
      granterUserTag: granter.user.tag,
      targetUserId: targetUser.id,
      targetUserTag: targetUser.tag,
      amount,
      reason,
      totalPoints: after.points,
      rankName: after.rankName,
      rankChanged: before.rankRoleId !== after.rankRoleId
    });

    await interaction.editReply(
      [
        `${amount > 0 ? "Somei" : "Removi"} **${Math.abs(amount)}** ponto${Math.abs(amount) === 1 ? "" : "s"} de <@${targetUser.id}>.`,
        `Total agora: **${after.points}** · Rank: **${after.rankName}**${before.rankRoleId !== after.rankRoleId ? ` (era ${before.rankName})` : ""}.`
      ].join("\n")
    );
  }
};
