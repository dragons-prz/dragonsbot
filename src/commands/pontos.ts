import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { getGuildId, requireGuildMember } from "../utils/discord";
import { SlashCommand } from "./types";

export const pontosCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("pontos")
    .setDescription("Mostra sua pontuacao de recrutamento."),

  async execute(interaction, { store }) {
    const guildId = getGuildId(interaction);
    const member = requireGuildMember(interaction);
    const stats = await store.getRecruiterStats(guildId, member.id);

    await interaction.reply({
      content: [
        `Voce tem **${stats.points}** ponto${stats.points === 1 ? "" : "s"} de recrutamento.`,
        `Recrutamentos aprovados: **${stats.approvedRecruitments}**.`
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
};
