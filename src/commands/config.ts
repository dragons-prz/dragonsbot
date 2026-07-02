import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { ChannelConfigKey, RoleConfigKey } from "../domain/types";
import { memberIsAdmin, requireGuildMember } from "../utils/discord";
import { logger } from "../utils/logger";
import { SlashCommand } from "./types";

export const configCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configura cargos e canais do Dragons.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-role")
        .setDescription("Configura um cargo usado pelo bot.")
        .addStringOption((option) =>
          option
            .setName("tipo")
            .setDescription("Tipo do cargo.")
            .setRequired(true)
            .addChoices(
              { name: "Recruiter", value: "recruiter" },
              { name: "Founder", value: "founder" },
              { name: "Member", value: "member" }
            )
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Cargo a ser configurado.").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-channel")
        .setDescription("Configura um canal usado pelo bot.")
        .addStringOption((option) =>
          option
            .setName("tipo")
            .setDescription("Tipo do canal.")
            .setRequired(true)
            .addChoices({ name: "Approval", value: "approval" })
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Canal a ser configurado.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("show").setDescription("Mostra a configuracao atual do servidor.")
    ),

  async execute(interaction, { store }) {
    const member = requireGuildMember(interaction);
    if (!memberIsAdmin(member)) {
      logger.warn("config.blocked", {
        reason: "missing_admin_permission",
        guildId: interaction.guildId,
        userId: member.id,
        userTag: member.user.tag
      });
      await interaction.reply({ content: "Apenas administradores podem usar este comando.", flags: MessageFlags.Ephemeral });
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: "Este comando so pode ser usado em um servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "set-role") {
      const key = interaction.options.getString("tipo", true) as RoleConfigKey;
      const role = interaction.options.getRole("role", true);
      await store.setRoleConfig(guildId, key, role.id);
      logger.info("config.role_set", {
        guildId,
        adminUserId: member.id,
        adminUserTag: member.user.tag,
        key,
        roleId: role.id
      });
      await interaction.reply({ content: `Cargo \`${key}\` configurado como <@&${role.id}>.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === "set-channel") {
      const key = interaction.options.getString("tipo", true) as ChannelConfigKey;
      const channel = interaction.options.getChannel("channel", true);
      await store.setChannelConfig(guildId, key, channel.id);
      logger.info("config.channel_set", {
        guildId,
        adminUserId: member.id,
        adminUserTag: member.user.tag,
        key,
        channelId: channel.id
      });
      await interaction.reply({ content: `Canal \`${key}\` configurado como <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const config = await store.getGuildConfig(guildId);
    logger.info("config.show", {
      guildId,
      adminUserId: member.id,
      adminUserTag: member.user.tag
    });
    await interaction.reply({
      content: [
        "**Configuracao atual do Dragons**",
        `Cargo recruiter: <@&${config.recruiterRoleId}> (\`${config.recruiterRoleId}\`)`,
        `Cargo founder: <@&${config.founderRoleId}> (\`${config.founderRoleId}\`)`,
        `Cargo member: <@&${config.memberRoleId}> (\`${config.memberRoleId}\`)`,
        `Canal approval: ${config.approvalChannelId ? `<#${config.approvalChannelId}> (\`${config.approvalChannelId}\`)` : "nao configurado"}`
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
};
