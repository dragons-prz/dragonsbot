import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder
} from "discord.js";
import { RECRUITMENT_POINTS } from "../domain/types";
import {
  getGuildId,
  memberHasRole,
  requireGuildMember
} from "../utils/discord";
import { logger } from "../utils/logger";
import { ButtonHandler, SlashCommand } from "./types";

const APPROVE_PREFIX = "recruitment:approve:";

function buildApprovedMessage(
  guildId: string,
  recruitmentId: number,
  recruitId: string,
  recruiterId: string,
  founderId: string,
  memberPoints: number,
  rankName: string
) {
  const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${APPROVE_PREFIX}${guildId}:${recruitmentId}`)
      .setLabel("Usuario adicionado")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true)
  );

  const embed = new EmbedBuilder()
    .setTitle("Recrutamento aprovado")
    .setColor(0x2f9e44)
    .addFields(
      { name: "Usuario recrutado", value: `<@${recruitId}>`, inline: true },
      { name: "ID copiavel", value: `\`${recruitId}\``, inline: true },
      { name: "Recrutador", value: `<@${recruiterId}>`, inline: true },
      { name: "Aprovado por", value: `<@${founderId}>`, inline: true },
      { name: "Pontos do membro", value: String(memberPoints), inline: true },
      { name: "Rank atual", value: rankName, inline: true }
    )
    .setTimestamp();

  return { embeds: [embed], components: [disabledRow] };
}

function buildApprovalMessage(guildId: string, recruitmentId: number, recruitId: string, recruiterId: string) {
  const embed = new EmbedBuilder()
    .setTitle("Recrutamento pendente")
    .setColor(0xd63f3f)
    .setDescription("Adicione o usuario na familia do servidor da Pureza. Depois confirme pelo botao abaixo.")
    .addFields(
      { name: "Usuario recrutado", value: `<@${recruitId}>`, inline: true },
      { name: "ID copiavel", value: `\`${recruitId}\``, inline: true },
      { name: "Recrutador", value: `<@${recruiterId}>`, inline: true },
      { name: "Recrutamento", value: `#${recruitmentId}`, inline: true }
    )
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${APPROVE_PREFIX}${guildId}:${recruitmentId}`)
      .setLabel("Adicionei na familia")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

export const recrutarCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("recrutar")
    .setDescription("Envia uma ficha de recrutamento para aprovacao.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Membro recrutado.").setRequired(true)
    ),

  async execute(interaction, { store }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = getGuildId(interaction);
    const recruiter = requireGuildMember(interaction);
    const config = await store.getGuildConfig(guildId);

    if (!memberHasRole(recruiter, config.recruiterRoleId)) {
      logger.warn("recruitment.blocked", {
        reason: "missing_recruiter_role",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        requiredRoleId: config.recruiterRoleId
      });
      await interaction.editReply("Voce nao possui o cargo de recrutamento.");
      return;
    }

    const recruitUser = interaction.options.getUser("usuario", true);
    logger.info("recruitment.requested", {
      guildId,
      recruiterUserId: recruiter.id,
      recruiterUserTag: recruiter.user.tag,
      recruitUserId: recruitUser.id,
      recruitUserTag: recruitUser.tag
    });

    const recruitMember = await interaction.guild!.members.fetch(recruitUser.id).catch(() => null);
    if (!recruitMember) {
      logger.warn("recruitment.blocked", {
        reason: "recruit_not_in_guild",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag
      });
      await interaction.editReply("O usuario informado nao esta no servidor.");
      return;
    }

    if (recruitMember.roles.cache.has(config.memberRoleId)) {
      logger.warn("recruitment.blocked", {
        reason: "recruit_already_member",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag,
        memberRoleId: config.memberRoleId
      });
      await interaction.editReply("Este usuario ja possui o cargo de membro.");
      return;
    }

    const pending = await store.findPendingRecruitmentByUser(guildId, recruitUser.id);
    if (pending) {
      if (!pending.approvalMessageId) {
        logger.warn("recruitment.pending_orphan_deleted", {
          guildId,
          recruitmentId: pending.id,
          recruitUserId: recruitUser.id
        });
        await store.deletePendingRecruitment(pending.id);
      } else {
        logger.warn("recruitment.blocked", {
          reason: "pending_exists",
          guildId,
          recruitmentId: pending.id,
          recruiterUserId: recruiter.id,
          recruiterUserTag: recruiter.user.tag,
          recruitUserId: recruitUser.id,
          recruitUserTag: recruitUser.tag
        });
        await interaction.editReply(`Ja existe um recrutamento pendente para este usuario (#${pending.id}).`);
        return;
      }
    }

    const founders = (await interaction.guild!.members.fetch()).filter(
      (member) => !member.user.bot && member.roles.cache.has(config.founderRoleId)
    );
    if (founders.size === 0) {
      logger.warn("recruitment.blocked", {
        reason: "no_founders_found",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag,
        founderRoleId: config.founderRoleId
      });
      await interaction.editReply("Nao encontrei nenhum Founder para receber a aprovacao por DM.");
      return;
    }

    const recruitment = await store.createRecruitment({
      guildId,
      recruitUserId: recruitUser.id,
      recruiterUserId: recruiter.id
    });
    logger.info("recruitment.created", {
      guildId,
      recruitmentId: recruitment.id,
      recruiterUserId: recruiter.id,
      recruiterUserTag: recruiter.user.tag,
      recruitUserId: recruitUser.id,
      recruitUserTag: recruitUser.tag,
      founderCount: founders.size
    });

    try {
      const approvalMessage = buildApprovalMessage(guildId, recruitment.id, recruitUser.id, recruiter.id);
      const sentMessages = await Promise.allSettled(
        founders.map(async (founderMember) => ({
          founderId: founderMember.id,
          message: await founderMember.send(approvalMessage)
        }))
      );
      const firstSent = sentMessages.find((result) => result.status === "fulfilled");
      const failedCount = sentMessages.filter((result) => result.status === "rejected").length;
      const sentCount = sentMessages.length - failedCount;

      if (!firstSent || firstSent.status !== "fulfilled") {
        throw new Error("Nenhum Founder recebeu a DM de aprovacao.");
      }

      await store.setRecruitmentApprovalMessage(recruitment.id, firstSent.value.message.id);
      for (const result of sentMessages) {
        if (result.status === "fulfilled") {
          await store.addRecruitmentApprovalMessage({
            recruitmentId: recruitment.id,
            founderUserId: result.value.founderId,
            channelId: result.value.message.channelId,
            messageId: result.value.message.id
          });
        }
      }

      await interaction.editReply(
        [
          `Recrutamento #${recruitment.id} enviado por DM para ${sentCount} Founder(s).`,
          failedCount > 0 ? `${failedCount} Founder(s) nao puderam receber DM do bot.` : null
        ].filter(Boolean).join("\n")
      );
      logger.info("recruitment.approval_dm_sent", {
        guildId,
        recruitmentId: recruitment.id,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag,
        sentCount,
        failedCount
      });
    } catch (error) {
      await store.deletePendingRecruitment(recruitment.id);
      logger.error("recruitment.approval_dm_failed", error, {
        guildId,
        recruitmentId: recruitment.id,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag
      });
      await interaction.editReply(
        [
          "Nao consegui enviar a ficha por DM para nenhum Founder.",
          "Verifique se existe alguem com o cargo Founder e se a pessoa aceita mensagens diretas deste servidor."
        ].join("\n")
      );
      return;
    }
  }
};

export const approveRecruitmentButton: ButtonHandler = {
  customIdPrefix: APPROVE_PREFIX,

  async execute(interaction, { store }) {
    const [guildId, recruitmentIdRaw] = interaction.customId.slice(APPROVE_PREFIX.length).split(":");
    const recruitmentId = Number(recruitmentIdRaw);
    if (!guildId || !Number.isInteger(recruitmentId)) {
      logger.warn("recruitment.approval_button_invalid", {
        customId: interaction.customId,
        userId: interaction.user.id,
        userTag: interaction.user.tag
      });
      await interaction.reply({ content: "Recrutamento invalido." });
      return;
    }

    await interaction.deferReply();

    const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      logger.warn("recruitment.approval_blocked", {
        reason: "guild_not_found",
        guildId,
        recruitmentId,
        founderUserId: interaction.user.id,
        founderUserTag: interaction.user.tag
      });
      await interaction.editReply("Servidor do recrutamento nao encontrado.");
      return;
    }

    const founder = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!founder) {
      logger.warn("recruitment.approval_blocked", {
        reason: "founder_not_in_guild",
        guildId,
        recruitmentId,
        founderUserId: interaction.user.id,
        founderUserTag: interaction.user.tag
      });
      await interaction.editReply("Nao consegui validar seu usuario no servidor.");
      return;
    }

    const config = await store.getGuildConfig(guildId);

    if (!memberHasRole(founder, config.founderRoleId)) {
      logger.warn("recruitment.approval_blocked", {
        reason: "missing_founder_role",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        requiredRoleId: config.founderRoleId
      });
      await interaction.editReply("Apenas Founders podem confirmar recrutamentos.");
      return;
    }

    const recruitment = await store.getRecruitment(recruitmentId);
    if (!recruitment || recruitment.guildId !== guildId) {
      logger.warn("recruitment.approval_blocked", {
        reason: "recruitment_not_found",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag
      });
      await interaction.editReply("Recrutamento nao encontrado.");
      return;
    }

    if (recruitment.status !== "pending") {
      logger.warn("recruitment.approval_blocked", {
        reason: "already_approved",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        status: recruitment.status
      });
      await interaction.editReply("Este recrutamento ja foi aprovado.");
      return;
    }

    const recruitMember = await guild.members.fetch(recruitment.recruitUserId).catch(() => null);
    if (!recruitMember) {
      logger.warn("recruitment.approval_blocked", {
        reason: "recruit_not_in_guild",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        recruitUserId: recruitment.recruitUserId
      });
      await interaction.editReply("O usuario recrutado saiu do servidor ou nao foi encontrado.");
      return;
    }
    const recruiterMember = await guild.members.fetch(recruitment.recruiterUserId).catch(() => null);

    const botMember = await guild.members.fetchMe();
    const memberRole = await guild.roles.fetch(config.memberRoleId).catch(() => null);
    if (!memberRole) {
      logger.warn("recruitment.approval_blocked", {
        reason: "member_role_not_found",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        memberRoleId: config.memberRoleId
      });
      await interaction.editReply("O cargo de membro configurado nao foi encontrado.");
      return;
    }

    if (!memberRole.editable || botMember.roles.highest.comparePositionTo(memberRole) <= 0) {
      logger.warn("recruitment.approval_blocked", {
        reason: "member_role_not_editable",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        memberRoleId: config.memberRoleId
      });
      await interaction.editReply("Nao consigo gerenciar o cargo de membro configurado. Verifique a hierarquia de cargos.");
      return;
    }

    await (recruitMember as GuildMember).roles.add(memberRole, `Recrutamento aprovado por ${founder.user.tag}`);
    const { profile: recruitedProfile, rank: baseRank } = await store.ensureMemberProfile(guildId, recruitMember.id);
    const baseRankRole = await guild.roles.fetch(baseRank.roleId).catch(() => null);
    if (baseRankRole && !recruitMember.roles.cache.has(baseRankRole.id)) {
      await recruitMember.roles.add(baseRankRole, `Rank inicial ${baseRank.name}`).catch((error) => {
        logger.error("hierarchy.base_rank_add_failed", error, {
          guildId,
          recruitmentId,
          userId: recruitMember.id,
          userTag: recruitMember.user.tag,
          rankName: recruitedProfile.rankName,
          rankRoleId: recruitedProfile.rankRoleId
        });
      });
    }

    const approval = await store.approveRecruitmentAndAddMemberPoints(
      recruitment.id,
      founder.id,
      RECRUITMENT_POINTS,
      `Recrutamento #${recruitment.id} aprovado`
    );
    if (!approval) {
      logger.warn("recruitment.approval_blocked", {
        reason: "transaction_already_approved",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag
      });
      await interaction.editReply("Este recrutamento ja foi aprovado.");
      return;
    }
    const { recruitment: approved, member: promotedMember } = approval;

    const currentRankRole = await guild.roles.fetch(promotedMember.rankRoleId).catch(() => null);
    if (!recruiterMember) {
      logger.warn("hierarchy.member_not_found", {
        guildId,
        recruitmentId,
        userId: promotedMember.userId,
        rankName: promotedMember.rankName,
        rankRoleId: promotedMember.rankRoleId
      });
    } else {
      if (approval.rankChanged) {
        const oldRank = await guild.roles.fetch(approval.previousRankRoleId).catch(() => null);
        if (oldRank && recruiterMember.roles.cache.has(oldRank.id)) {
          await recruiterMember.roles.remove(oldRank, `Promocao automatica para ${promotedMember.rankName}`).catch((error) => {
            logger.error("hierarchy.old_rank_remove_failed", error, {
              guildId,
              recruitmentId,
              userId: recruiterMember.id,
              userTag: recruiterMember.user.tag,
              oldRankRoleId: oldRank.id
            });
          });
        }
      }

      if (currentRankRole && !recruiterMember.roles.cache.has(currentRankRole.id)) {
        await recruiterMember.roles.add(currentRankRole, `Sincronizacao automatica de rank ${promotedMember.rankName}`).catch((error) => {
          logger.error("hierarchy.rank_role_add_failed", error, {
            guildId,
            recruitmentId,
            userId: recruiterMember.id,
            userTag: recruiterMember.user.tag,
            rankName: promotedMember.rankName,
            rankRoleId: promotedMember.rankRoleId
          });
        });
      }

      if (approval.rankChanged) {
        await recruiterMember.send(`Parabens! Voce upou para o cargo **${promotedMember.rankName}**.`).catch((error) => {
          logger.error("hierarchy.rank_up_dm_failed", error, {
            guildId,
            recruitmentId,
            userId: recruiterMember.id,
            userTag: recruiterMember.user.tag,
            rankName: promotedMember.rankName,
            rankRoleId: promotedMember.rankRoleId
          });
        });
        logger.info("hierarchy.rank_up", {
          guildId,
          recruitmentId,
          userId: recruiterMember.id,
          userTag: recruiterMember.user.tag,
          previousRankName: approval.previousRankName,
          previousRankRoleId: approval.previousRankRoleId,
          rankName: promotedMember.rankName,
          rankRoleId: promotedMember.rankRoleId,
          points: promotedMember.points
        });
      }

      if (!currentRankRole) {
        logger.warn("hierarchy.rank_role_not_found", {
          guildId,
          recruitmentId,
          userId: promotedMember.userId,
          rankName: promotedMember.rankName,
          rankRoleId: promotedMember.rankRoleId
        });
      }
    }

    const approvedMessage = buildApprovedMessage(
      approved.guildId,
      approved.id,
      approved.recruitUserId,
      approved.recruiterUserId,
      founder.id,
      promotedMember.points,
      promotedMember.rankName
    );
    const approvalMessages = await store.getRecruitmentApprovalMessages(approved.id);
    const updateResults = await Promise.allSettled(
      approvalMessages.map(async (approvalMessage) => {
        const channel = await interaction.client.channels.fetch(approvalMessage.channelId);
        if (!channel || !channel.isTextBased()) {
          return;
        }

        const message = await channel.messages.fetch(approvalMessage.messageId);
        await message.edit(approvedMessage);
      })
    );
    const updatedMessages = updateResults.filter((result) => result.status === "fulfilled").length;
    const failedMessageUpdates = updateResults.length - updatedMessages;

    logger.info("recruitment.approved", {
      guildId,
      recruitmentId: approved.id,
      founderUserId: founder.id,
      founderUserTag: founder.user.tag,
      recruiterUserId: approved.recruiterUserId,
      recruiterUserTag: recruiterMember?.user.tag,
      recruitUserId: approved.recruitUserId,
      recruitUserTag: recruitMember.user.tag,
      pointsAdded: RECRUITMENT_POINTS,
      memberTotalPoints: promotedMember.points,
      memberRecruitments: promotedMember.recruitments,
      memberRankName: promotedMember.rankName,
      rankChanged: approval.rankChanged,
      approvalMessages: approvalMessages.length,
      updatedMessages,
      failedMessageUpdates
    });

    await interaction.editReply(`Recrutamento aprovado. <@${approved.recruiterUserId}> recebeu ${RECRUITMENT_POINTS} pontos.`);
  }
};
