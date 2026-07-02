import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { getGuildId } from "../utils/discord";
import { logger } from "../utils/logger";
import { SlashCommand } from "./types";

export const rankingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ranking")
    .setDescription("Mostra o ranking de membros por pontos.")
    .addIntegerOption((option) =>
      option
        .setName("limite")
        .setDescription("Quantidade de membros no ranking.")
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction, { store }) {
    const guildId = getGuildId(interaction);
    const limit = interaction.options.getInteger("limite") ?? 10;
    const ranking = await store.getMemberRanking(guildId, limit);
    logger.info("ranking.viewed", {
      guildId,
      userId: interaction.user.id,
      userTag: interaction.user.tag,
      requestedLimit: limit,
      returnedCount: ranking.length
    });

    if (ranking.length === 0) {
      await interaction.reply({
        content: "Ainda nao ha membros com pontos no ranking.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = ranking.map((entry) => {
      const pointsLabel = entry.points === 1 ? "ponto" : "pontos";
      const recruitmentLabel = entry.recruitments === 1 ? "recrutamento" : "recrutamentos";
      return `**${entry.position}.** <@${entry.userId}> - **${entry.points}** ${pointsLabel} | **${entry.recruitments}** ${recruitmentLabel} | **${entry.rankName}**`;
    });

    const embed = new EmbedBuilder()
      .setTitle("Ranking de Membros")
      .setColor(0xd63f3f)
      .setDescription(lines.join("\n"))
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
