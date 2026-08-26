import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { PanelButtonStyle, PanelConfig } from "../domain/types";
import { memberIsAdmin, requireGuildMember } from "../utils/discord";
import { logger } from "../utils/logger";
import { ButtonHandler, SlashCommand } from "./types";

const CUSTOM_ID_PREFIX = "panel:";
const BUTTON_STYLE_MAP: Record<PanelButtonStyle, ButtonStyle> = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger
};

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function buildPanelMessage(panel: PanelConfig) {
  const embed = new EmbedBuilder().setTitle(panel.title).setDescription(panel.description);
  if (panel.imageUrl) {
    embed.setImage(panel.imageUrl);
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < panel.buttons.length; i += 5) {
    const chunk = panel.buttons.slice(i, i + 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      chunk.map((button) => {
        const builder = new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID_PREFIX}${panel.id}:${button.id}`)
          .setLabel(button.label)
          .setStyle(BUTTON_STYLE_MAP[button.style]);
        if (button.emoji) {
          builder.setEmoji(button.emoji);
        }
        return builder;
      })
    );
    rows.push(row);
  }

  return { embeds: [embed], components: rows };
}

export const painelCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Cria e configura paineis de botoes informativos.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("criar")
        .setDescription("Cria um novo painel.")
        .addStringOption((option) => option.setName("id").setDescription("Identificador unico do painel.").setRequired(true))
        .addStringOption((option) => option.setName("titulo").setDescription("Titulo do painel.").setRequired(true))
        .addStringOption((option) => option.setName("descricao").setDescription("Descricao do painel.").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-imagem")
        .setDescription("Define a imagem de um painel.")
        .addStringOption((option) => option.setName("id").setDescription("Identificador do painel.").setRequired(true))
        .addAttachmentOption((option) => option.setName("imagem").setDescription("Imagem do painel.").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add-botao")
        .setDescription("Adiciona um botao a um painel.")
        .addStringOption((option) => option.setName("id").setDescription("Identificador do painel.").setRequired(true))
        .addStringOption((option) => option.setName("label").setDescription("Texto exibido no botao.").setRequired(true))
        .addStringOption((option) =>
          option.setName("resposta").setDescription("Mensagem enviada ao usuario que clicar no botao.").setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("estilo")
            .setDescription("Cor do botao.")
            .addChoices(
              { name: "Cinza", value: "Secondary" },
              { name: "Azul", value: "Primary" },
              { name: "Verde", value: "Success" },
              { name: "Vermelho", value: "Danger" }
            )
        )
        .addStringOption((option) => option.setName("emoji").setDescription("Emoji exibido no botao."))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remover-botao")
        .setDescription("Remove um botao de um painel.")
        .addStringOption((option) => option.setName("id").setDescription("Identificador do painel.").setRequired(true))
        .addStringOption((option) => option.setName("botao-id").setDescription("Identificador do botao.").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("publicar")
        .setDescription("Publica um painel em um canal.")
        .addStringOption((option) => option.setName("id").setDescription("Identificador do painel.").setRequired(true))
        .addChannelOption((option) =>
          option
            .setName("canal")
            .setDescription("Canal onde o painel sera publicado.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName("listar").setDescription("Lista os paineis do servidor.")),

  async execute(interaction, { store }) {
    const member = requireGuildMember(interaction);
    if (!memberIsAdmin(member)) {
      await interaction.reply({ content: "Apenas administradores podem usar este comando.", flags: MessageFlags.Ephemeral });
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: "Este comando so pode ser usado em um servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "criar") {
      const id = slugify(interaction.options.getString("id", true));
      const titulo = interaction.options.getString("titulo", true);
      const descricao = interaction.options.getString("descricao", true);
      if (!id) {
        await interaction.reply({ content: "Id invalido. Use letras, numeros ou hifen.", flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        await store.createPanel(guildId, id, titulo, descricao);
        logger.info("panel.created", { guildId, panelId: id, adminUserId: member.id });
        await interaction.reply({ content: `Painel \`${id}\` criado. Use \`/painel add-botao\` para adicionar botoes.`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.reply({ content: (error as Error).message, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (subcommand === "set-imagem") {
      const id = interaction.options.getString("id", true);
      const attachment = interaction.options.getAttachment("imagem", true);
      try {
        await store.setPanelImage(guildId, id, attachment.url);
        logger.info("panel.image_set", { guildId, panelId: id, adminUserId: member.id });
        await interaction.reply({ content: `Imagem do painel \`${id}\` atualizada.`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.reply({ content: (error as Error).message, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (subcommand === "add-botao") {
      const id = interaction.options.getString("id", true);
      const label = interaction.options.getString("label", true);
      const resposta = interaction.options.getString("resposta", true);
      const estilo = (interaction.options.getString("estilo") ?? "Secondary") as PanelButtonStyle;
      const emoji = interaction.options.getString("emoji");
      const buttonId = slugify(label);

      try {
        await store.addPanelButton(guildId, id, {
          id: buttonId,
          label,
          response: resposta,
          style: estilo,
          emoji: emoji ?? null
        });
        logger.info("panel.button_added", { guildId, panelId: id, buttonId, adminUserId: member.id });
        await interaction.reply({ content: `Botao \`${buttonId}\` adicionado ao painel \`${id}\`.`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.reply({ content: (error as Error).message, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (subcommand === "remover-botao") {
      const id = interaction.options.getString("id", true);
      const buttonId = interaction.options.getString("botao-id", true);
      try {
        await store.removePanelButton(guildId, id, buttonId);
        logger.info("panel.button_removed", { guildId, panelId: id, buttonId, adminUserId: member.id });
        await interaction.reply({ content: `Botao \`${buttonId}\` removido do painel \`${id}\`.`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        await interaction.reply({ content: (error as Error).message, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (subcommand === "publicar") {
      const id = interaction.options.getString("id", true);
      const channel = interaction.options.getChannel("canal", true);
      const panel = await store.getPanel(guildId, id);
      if (!panel) {
        await interaction.reply({ content: `Painel \`${id}\` nao encontrado.`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (panel.buttons.length === 0) {
        await interaction.reply({ content: `Painel \`${id}\` ainda nao tem botoes.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const target = interaction.guild?.channels.cache.get(channel.id);
      if (!target || !target.isTextBased()) {
        await interaction.reply({ content: "Canal invalido.", flags: MessageFlags.Ephemeral });
        return;
      }

      await target.send(buildPanelMessage(panel));
      logger.info("panel.published", { guildId, panelId: id, channelId: channel.id, adminUserId: member.id });
      await interaction.reply({ content: `Painel \`${id}\` publicado em <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const panels = await store.listPanels(guildId);
    if (panels.length === 0) {
      await interaction.reply({ content: "Nenhum painel criado ainda.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      content: panels
        .map((panel) => `\`${panel.id}\` - ${panel.title} (${panel.buttons.length} botoes)`)
        .join("\n"),
      flags: MessageFlags.Ephemeral
    });
  }
};

export const panelButtonHandler: ButtonHandler = {
  customIdPrefix: CUSTOM_ID_PREFIX,

  async execute(interaction, { store }) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ content: "Este botao so pode ser usado em um servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    const [, panelId, buttonId] = interaction.customId.split(":");
    const panel = await store.getPanel(guildId, panelId);
    const button = panel?.buttons.find((item) => item.id === buttonId);
    if (!panel || !button) {
      await interaction.reply({ content: "Este botao nao esta mais disponivel.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: button.response, flags: MessageFlags.Ephemeral });
  }
};
