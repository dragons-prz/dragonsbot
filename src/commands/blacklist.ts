import { EmbedBuilder, Guild, MessageFlags, SlashCommandBuilder } from "discord.js";
import { memberHasRole, requireGuildMember } from "../utils/discord";
import { isSendableTextChannel } from "../utils/discord";
import { logger } from "../utils/logger";
import { SlashCommand } from "./types";

async function sendBlacklistLog(
  guild: Guild,
  channelId: string,
  embed: EmbedBuilder,
  context: { guildId: string; targetUserId: string; action: "added" | "removed" }
): Promise<void> {
  const logChannel = guild.channels.cache.get(channelId);
  if (!logChannel || !isSendableTextChannel(logChannel)) {
    logger.warn("blacklist.log_skipped", { reason: "channel_not_found", channelId, ...context });
    return;
  }

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    logger.warn("blacklist.log_skipped", {
      reason: "send_failed",
      channelId,
      error: error instanceof Error ? error.message : String(error),
      ...context
    });
  }
}

export const blacklistCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Gerencia a lista negra de membros que nunca podem ser verificados/recrutados.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Adiciona um usuario na blacklist.")
        .addUserOption((option) => option.setName("usuario").setDescription("Usuario a bloquear.").setRequired(true))
        .addStringOption((option) => option.setName("motivo").setDescription("Motivo do bloqueio.").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove um usuario da blacklist.")
        .addUserOption((option) => option.setName("usuario").setDescription("Usuario a desbloquear.").setRequired(true))
    )
    .addSubcommand((subcommand) => subcommand.setName("listar").setDescription("Lista os usuarios na blacklist.")),

  async execute(interaction, { store }) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: "Este comando so pode ser usado em um servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    const founder = requireGuildMember(interaction);
    const config = await store.getGuildConfig(guildId);
    if (!memberHasRole(founder, config.founderRoleId)) {
      logger.warn("blacklist.blocked", {
        reason: "missing_founder_role",
        guildId,
        userId: founder.id,
        userTag: founder.user.tag,
        requiredRoleId: config.founderRoleId
      });
      await interaction.reply({ content: "Apenas Founders podem gerenciar a blacklist.", flags: MessageFlags.Ephemeral });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "add") {
      const targetUser = interaction.options.getUser("usuario", true);
      const reason = interaction.options.getString("motivo", true);

      const targetMember = await interaction.guild!.members.fetch(targetUser.id).catch(() => null);
      if (targetMember && memberHasRole(targetMember, config.founderRoleId)) {
        logger.warn("blacklist.blocked", {
          reason: "target_is_founder",
          guildId,
          adminUserId: founder.id,
          targetUserId: targetUser.id
        });
        await interaction.reply({ content: "Founders nao podem ser adicionados na blacklist.", flags: MessageFlags.Ephemeral });
        return;
      }

      const existing = await store.getBlacklistEntry(guildId, targetUser.id);
      if (existing) {
        await interaction.reply({ content: `<@${targetUser.id}> ja esta na blacklist. Motivo atual: ${existing.reason}`, flags: MessageFlags.Ephemeral });
        return;
      }

      await store.addToBlacklist(guildId, targetUser.id, reason, founder.id);
      logger.info("blacklist.added", {
        guildId,
        adminUserId: founder.id,
        adminUserTag: founder.user.tag,
        targetUserId: targetUser.id,
        targetUserTag: targetUser.tag,
        reason
      });

      const addedEmbed = new EmbedBuilder()
        .setTitle("Membro adicionado a blacklist")
        .setColor(0xc92a2a)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: "Usuario", value: `<@${targetUser.id}> (\`${targetUser.id}\`)` },
          { name: "Motivo", value: reason },
          { name: "Adicionado por", value: `<@${founder.id}>` }
        )
        .setTimestamp(new Date());
      await sendBlacklistLog(interaction.guild!, config.blacklistLogChannelId, addedEmbed, {
        guildId,
        targetUserId: targetUser.id,
        action: "added"
      });

      await interaction.reply({ content: `<@${targetUser.id}> foi adicionado a blacklist.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === "remove") {
      const targetUser = interaction.options.getUser("usuario", true);
      const removed = await store.removeFromBlacklist(guildId, targetUser.id);
      if (!removed) {
        await interaction.reply({ content: `<@${targetUser.id}> nao esta na blacklist.`, flags: MessageFlags.Ephemeral });
        return;
      }

      logger.info("blacklist.removed", {
        guildId,
        adminUserId: founder.id,
        adminUserTag: founder.user.tag,
        targetUserId: targetUser.id,
        targetUserTag: targetUser.tag
      });

      const removedEmbed = new EmbedBuilder()
        .setTitle("Membro removido da blacklist")
        .setColor(0x2f9e44)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: "Usuario", value: `<@${targetUser.id}> (\`${targetUser.id}\`)` },
          { name: "Removido por", value: `<@${founder.id}>` }
        )
        .setTimestamp(new Date());
      await sendBlacklistLog(interaction.guild!, config.blacklistLogChannelId, removedEmbed, {
        guildId,
        targetUserId: targetUser.id,
        action: "removed"
      });

      await interaction.reply({ content: `<@${targetUser.id}> foi removido da blacklist.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const entries = await store.listBlacklist(guildId);
    if (entries.length === 0) {
      await interaction.reply({ content: "Nenhum usuario na blacklist.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      content: entries.map((entry) => `<@${entry.userId}> - ${entry.reason} (adicionado por <@${entry.addedByUserId}>)`).join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
};
