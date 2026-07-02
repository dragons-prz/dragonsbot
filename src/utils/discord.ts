import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  RepliableInteraction,
  TextBasedChannel
} from "discord.js";
import { logger } from "./logger";

export function getGuildId(interaction: ChatInputCommandInteraction | ButtonInteraction): string {
  if (!interaction.guildId || !interaction.guild) {
    throw new Error("Este comando so pode ser usado dentro de um servidor.");
  }

  return interaction.guildId;
}

export function requireGuildMember(interaction: ChatInputCommandInteraction | ButtonInteraction): GuildMember {
  if (!interaction.member || !(interaction.member instanceof GuildMember)) {
    throw new Error("Nao foi possivel validar o membro no servidor.");
  }

  return interaction.member;
}

export function memberHasRole(member: GuildMember, roleId: string): boolean {
  return member.roles.cache.has(roleId);
}

export function memberIsAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

export function isSendableTextChannel(channel: unknown): channel is TextBasedChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel);
}

export async function safeReply(
  interaction: ChatInputCommandInteraction | ButtonInteraction | RepliableInteraction,
  content: string,
  ephemeral = true
): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
      return;
    }

    await interaction.reply({ content, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error.code === 10062 || error.code === 40060)) {
      logger.warn("interaction.reply_skipped", {
        reason: "expired_or_already_replied",
        code: error.code
      });
      return;
    }

    throw error;
  }
}
