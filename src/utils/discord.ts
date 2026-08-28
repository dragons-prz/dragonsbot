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

export function memberHasAnyRole(member: GuildMember, roleIds: readonly string[]): boolean {
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

/**
 * Normaliza um texto livre para um slug seguro (letras minusculas, numeros
 * e hifen). Usado como id de painel/botao/opcao e como base de nome de
 * topico de ticket. `maxLength` default 40 (limite de id); nomes de topico
 * do Discord aceitam 100.
 */
export function slugify(value: string, maxLength = 40): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, maxLength);
}

/** Substitui `{chave}` por `vars[chave]` num template; deixa intacto o que nao casar. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? vars[key] : match));
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
