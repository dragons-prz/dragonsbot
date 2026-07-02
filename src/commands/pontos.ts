import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { getGuildId, requireGuildMember } from "../utils/discord";
import { logger } from "../utils/logger";
import { SlashCommand } from "./types";

export const pontosCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("pontos")
    .setDescription("Mostra sua pontuacao, recrutamentos e rank atual."),

  async execute(interaction, { store }) {
    const guildId = getGuildId(interaction);
    const member = requireGuildMember(interaction);
    const profile = await store.getMemberProfile(guildId, member.id);
    logger.info("points.viewed", {
      guildId,
      userId: member.id,
      userTag: member.user.tag,
      points: profile.points,
      recruitments: profile.recruitments,
      rankName: profile.rankName
    });

    await interaction.reply({
      content: [
        `Voce tem **${profile.points}** ponto${profile.points === 1 ? "" : "s"}.`,
        `Recrutamentos aprovados: **${profile.recruitments}**.`,
        `Rank atual: **${profile.rankName}**.`
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
};
