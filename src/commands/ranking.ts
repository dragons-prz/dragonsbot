import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { getGuildId } from "../utils/discord";
import { SlashCommand } from "./types";

export const rankingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ranking")
    .setDescription("Mostra o ranking de recrutamento.")
    .addIntegerOption((option) =>
      option
        .setName("limite")
        .setDescription("Quantidade de recrutadores no ranking.")
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),

  async execute(interaction, { store }) {
    const guildId = getGuildId(interaction);
    const limit = interaction.options.getInteger("limite") ?? 10;
    const ranking = await store.getRecruiterRanking(guildId, limit);

    if (ranking.length === 0) {
      await interaction.reply({
        content: "Ainda nao ha recrutadores com pontos no ranking.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = ranking.map((entry) => {
      const pointsLabel = entry.points === 1 ? "ponto" : "pontos";
      const recruitmentLabel = entry.approvedRecruitments === 1 ? "recrutamento" : "recrutamentos";
      return `**${entry.position}.** <@${entry.recruiterUserId}> - **${entry.points}** ${pointsLabel} | **${entry.approvedRecruitments}** ${recruitmentLabel}`;
    });

    const embed = new EmbedBuilder()
      .setTitle("Ranking de Recrutamento")
      .setColor(0xd63f3f)
      .setDescription(lines.join("\n"))
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
