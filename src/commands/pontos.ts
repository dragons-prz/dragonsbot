import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { getGuildId, requireGuildMember } from "../utils/discord";
import { logger } from "../utils/logger";
import { SlashCommand } from "./types";

export const pontosCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("pontos")
    .setDescription("Mostra sua pontuacao de recrutamento."),

  async execute(interaction, { store }) {
    const guildId = getGuildId(interaction);
    const member = requireGuildMember(interaction);
    const stats = await store.getRecruiterStats(guildId, member.id);
    logger.info("points.viewed", {
      guildId,
      userId: member.id,
      userTag: member.user.tag,
      points: stats.points,
      approvedRecruitments: stats.approvedRecruitments
    });

    await interaction.reply({
      content: [
        `Voce tem **${stats.points}** ponto${stats.points === 1 ? "" : "s"} de recrutamento.`,
        `Recrutamentos aprovados: **${stats.approvedRecruitments}**.`
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
};
