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
import { ButtonHandler, SlashCommand } from "./types";

const APPROVE_PREFIX = "recruitment:approve:";

function buildApprovedMessage(
  guildId: string,
  recruitmentId: number,
  recruitId: string,
  recruiterId: string,
  founderId: string,
  recruiterPoints: number
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
      { name: "Pontos do recrutador", value: String(recruiterPoints), inline: true }
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
      await interaction.editReply("Voce nao possui o cargo de recrutamento.");
      return;
    }

    const recruitUser = interaction.options.getUser("usuario", true);

    const recruitMember = await interaction.guild!.members.fetch(recruitUser.id).catch(() => null);
    if (!recruitMember) {
      await interaction.editReply("O usuario informado nao esta no servidor.");
      return;
    }

    if (recruitMember.roles.cache.has(config.memberRoleId)) {
      await interaction.editReply("Este usuario ja possui o cargo de membro.");
      return;
    }

    const pending = await store.findPendingRecruitmentByUser(guildId, recruitUser.id);
    if (pending) {
      if (!pending.approvalMessageId) {
        await store.deletePendingRecruitment(pending.id);
      } else {
        await interaction.editReply(`Ja existe um recrutamento pendente para este usuario (#${pending.id}).`);
        return;
      }
    }

    const founders = (await interaction.guild!.members.fetch()).filter(
      (member) => !member.user.bot && member.roles.cache.has(config.founderRoleId)
    );
    if (founders.size === 0) {
      await interaction.editReply("Nao encontrei nenhum Founder para receber a aprovacao por DM.");
      return;
    }

    const recruitment = await store.createRecruitment({
      guildId,
      recruitUserId: recruitUser.id,
      recruiterUserId: recruiter.id
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
          `Recrutamento #${recruitment.id} enviado por DM para ${sentMessages.length - failedCount} Founder(s).`,
          failedCount > 0 ? `${failedCount} Founder(s) nao puderam receber DM do bot.` : null
        ].filter(Boolean).join("\n")
      );
    } catch (error) {
      await store.deletePendingRecruitment(recruitment.id);
      console.error("Falha ao enviar DMs de aprovacao:", error);
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
      await interaction.reply({ content: "Recrutamento invalido." });
      return;
    }

    await interaction.deferReply();

    const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      await interaction.editReply("Servidor do recrutamento nao encontrado.");
      return;
    }

    const founder = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!founder) {
      await interaction.editReply("Nao consegui validar seu usuario no servidor.");
      return;
    }

    const config = await store.getGuildConfig(guildId);

    if (!memberHasRole(founder, config.founderRoleId)) {
      await interaction.editReply("Apenas Founders podem confirmar recrutamentos.");
      return;
    }

    const recruitment = await store.getRecruitment(recruitmentId);
    if (!recruitment || recruitment.guildId !== guildId) {
      await interaction.editReply("Recrutamento nao encontrado.");
      return;
    }

    if (recruitment.status !== "pending") {
      await interaction.editReply("Este recrutamento ja foi aprovado.");
      return;
    }

    const recruitMember = await guild.members.fetch(recruitment.recruitUserId).catch(() => null);
    if (!recruitMember) {
      await interaction.editReply("O usuario recrutado saiu do servidor ou nao foi encontrado.");
      return;
    }

    const botMember = await guild.members.fetchMe();
    const memberRole = await guild.roles.fetch(config.memberRoleId).catch(() => null);
    if (!memberRole) {
      await interaction.editReply("O cargo de membro configurado nao foi encontrado.");
      return;
    }

    if (!memberRole.editable || botMember.roles.highest.comparePositionTo(memberRole) <= 0) {
      await interaction.editReply("Nao consigo gerenciar o cargo de membro configurado. Verifique a hierarquia de cargos.");
      return;
    }

    await (recruitMember as GuildMember).roles.add(memberRole, `Recrutamento aprovado por ${founder.user.tag}`);

    const approval = await store.approveRecruitmentAndAddPoints(
      recruitment.id,
      founder.id,
      RECRUITMENT_POINTS,
      `Recrutamento #${recruitment.id} aprovado`
    );
    if (!approval) {
      await interaction.editReply("Este recrutamento ja foi aprovado.");
      return;
    }
    const { recruitment: approved, recruiterPoints } = approval;

    const approvedMessage = buildApprovedMessage(
      approved.guildId,
      approved.id,
      approved.recruitUserId,
      approved.recruiterUserId,
      founder.id,
      recruiterPoints.points
    );
    const approvalMessages = await store.getRecruitmentApprovalMessages(approved.id);
    await Promise.allSettled(
      approvalMessages.map(async (approvalMessage) => {
        const channel = await interaction.client.channels.fetch(approvalMessage.channelId);
        if (!channel || !channel.isTextBased()) {
          return;
        }

        const message = await channel.messages.fetch(approvalMessage.messageId);
        await message.edit(approvedMessage);
      })
    );

    await interaction.editReply(`Recrutamento aprovado. <@${approved.recruiterUserId}> recebeu ${RECRUITMENT_POINTS} pontos.`);
  }
};
