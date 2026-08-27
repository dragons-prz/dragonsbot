import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ColorResolvable,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { PanelButtonStyle, PanelConfig, PanelJob } from "../domain/types";
import { memberIsAdmin, requireGuildMember } from "../utils/discord";
import { startJobWorker } from "../utils/jobWorker";
import { logger } from "../utils/logger";
import { ButtonHandler, SlashCommand } from "./types";

const CUSTOM_ID_PREFIX = "panel:";
const BUTTON_STYLE_MAP: Record<PanelButtonStyle, ButtonStyle> = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger
};
const PANEL_JOB_STALE_AFTER_MS = 5 * 60 * 1000;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const CLEAR_COLOR_KEYWORDS = new Set(["limpar", "nenhuma", "remover", "none"]);

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export function buildPanelMessage(panel: PanelConfig) {
  const embed = new EmbedBuilder().setTitle(panel.title).setDescription(panel.description);
  if (panel.imageUrl) {
    embed.setImage(panel.imageUrl);
  }
  if (panel.color) {
    embed.setColor(panel.color as ColorResolvable);
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

type CommandStore = Parameters<SlashCommand["execute"]>[1]["store"];
type PublishAction = "published" | "updated";

interface PublishPanelResult {
  action: PublishAction;
  messageId: string;
}

async function publishPanelToChannel(
  client: Client,
  store: CommandStore,
  panel: PanelConfig,
  channelId: string
): Promise<PublishPanelResult> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error("Canal invalido ou nao encontrado.");
  }

  const payload = buildPanelMessage(panel);

  if (panel.publishedMessageId && panel.publishedChannelId === channelId) {
    const existingMessage = await channel.messages.fetch(panel.publishedMessageId).catch(() => null);
    if (existingMessage) {
      await existingMessage.edit(payload);
      await store.setPanelPublishedMessage(panel.guildId, panel.id, channelId, existingMessage.id);
      return { action: "updated", messageId: existingMessage.id };
    }
    logger.warn("panel.published_message_missing", {
      guildId: panel.guildId,
      panelId: panel.id,
      channelId,
      previousMessageId: panel.publishedMessageId
    });
  }

  const sentMessage = await channel.send(payload);
  await store.setPanelPublishedMessage(panel.guildId, panel.id, channelId, sentMessage.id);
  return { action: "published", messageId: sentMessage.id };
}

async function processPanelJob(client: Client, store: CommandStore, job: PanelJob): Promise<void> {
  const panel = await store.getPanel(job.guildId, job.panelId);
  if (!panel) {
    throw new Error(`Painel "${job.panelId}" nao encontrado.`);
  }

  const result = await publishPanelToChannel(client, store, panel, job.channelId);
  await store.completePanelJob(job.id, result.messageId);

  logger.info(result.action === "updated" ? "panel_job.updated" : "panel_job.published", {
    jobId: job.id,
    guildId: job.guildId,
    panelId: job.panelId,
    channelId: job.channelId,
    messageId: result.messageId,
    requestedByUserId: job.requestedByUserId
  });
}

export function startPanelJobWorker(client: Client, store: CommandStore): () => void {
  const drainOne = async (): Promise<boolean> => {
    const job = await store.claimNextPendingPanelJob();
    if (!job) {
      return false;
    }

    logger.info("panel_job.claimed", {
      jobId: job.id,
      guildId: job.guildId,
      panelId: job.panelId,
      channelId: job.channelId,
      requestedByUserId: job.requestedByUserId,
      attempts: job.attempts
    });

    try {
      await processPanelJob(client, store, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("panel_job.failed", error, {
        jobId: job.id,
        guildId: job.guildId,
        panelId: job.panelId,
        channelId: job.channelId
      });
      await store.failPanelJob(job.id, message);
    }

    return true;
  };

  return startJobWorker({
    name: "panel_job",
    resetStale: () => store.resetStalePanelJobs(PANEL_JOB_STALE_AFTER_MS),
    drainOne,
    watch: (onPending) => store.watchPendingPanelJobs(onPending)
  });
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
        .addStringOption((option) =>
          option.setName("cor").setDescription("Cor lateral do embed, formato hex (ex: #E03131).")
        )
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
        .setName("set-cor")
        .setDescription("Define a cor lateral do embed de um painel.")
        .addStringOption((option) => option.setName("id").setDescription("Identificador do painel.").setRequired(true))
        .addStringOption((option) =>
          option
            .setName("cor")
            .setDescription("Cor em hex (ex: #E03131), ou \"limpar\" para remover.")
            .setRequired(true)
        )
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
        .addAttachmentOption((option) =>
          option.setName("resposta-imagem").setDescription("Imagem exibida na resposta do botao.")
        )
        .addStringOption((option) =>
          option.setName("resposta-cor").setDescription("Cor lateral da resposta do botao, formato hex (ex: #E03131).")
        )
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
      const cor = interaction.options.getString("cor");
      if (!id) {
        await interaction.reply({ content: "Id invalido. Use letras, numeros ou hifen.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (cor && !HEX_COLOR_REGEX.test(cor)) {
        await interaction.reply({ content: "Cor invalida. Use o formato hex, ex: `#E03131`.", flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        await store.createPanel(guildId, id, titulo, descricao);
        if (cor) {
          await store.setPanelColor(guildId, id, cor);
        }
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

    if (subcommand === "set-cor") {
      const id = interaction.options.getString("id", true);
      const corInput = interaction.options.getString("cor", true);
      const shouldClear = CLEAR_COLOR_KEYWORDS.has(corInput.trim().toLowerCase());
      if (!shouldClear && !HEX_COLOR_REGEX.test(corInput)) {
        await interaction.reply({
          content: "Cor invalida. Use o formato hex, ex: `#E03131`, ou `limpar` para remover.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      try {
        await store.setPanelColor(guildId, id, shouldClear ? null : corInput);
        logger.info("panel.color_set", { guildId, panelId: id, adminUserId: member.id, color: shouldClear ? null : corInput });
        await interaction.reply({
          content: shouldClear
            ? `Cor do painel \`${id}\` removida.`
            : `Cor do painel \`${id}\` atualizada.`,
          flags: MessageFlags.Ephemeral
        });
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
      const respostaImagem = interaction.options.getAttachment("resposta-imagem");
      const respostaCor = interaction.options.getString("resposta-cor");
      const buttonId = slugify(label);

      if (respostaCor && !HEX_COLOR_REGEX.test(respostaCor)) {
        await interaction.reply({ content: "Cor da resposta invalida. Use o formato hex, ex: `#E03131`.", flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        await store.addPanelButton(guildId, id, {
          id: buttonId,
          label,
          response: resposta,
          style: estilo,
          emoji: emoji ?? null,
          responseImageUrl: respostaImagem?.url ?? null,
          responseColor: respostaCor ?? null
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

      try {
        const result = await publishPanelToChannel(interaction.client, store, panel, channel.id);
        logger.info(result.action === "updated" ? "panel_job.updated" : "panel_job.published", {
          guildId,
          panelId: id,
          channelId: channel.id,
          messageId: result.messageId,
          adminUserId: member.id,
          source: "command"
        });
        await interaction.reply({
          content: result.action === "updated"
            ? `Painel \`${id}\` atualizado em <#${channel.id}>.`
            : `Painel \`${id}\` publicado em <#${channel.id}>.`,
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        logger.error("panel_job.failed", error, { guildId, panelId: id, channelId: channel.id, source: "command" });
        await interaction.reply({ content: (error as Error).message, flags: MessageFlags.Ephemeral });
      }
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

    const responseEmbed = new EmbedBuilder().setDescription(button.response);
    if (button.responseImageUrl) {
      responseEmbed.setImage(button.responseImageUrl);
    }
    if (button.responseColor) {
      responseEmbed.setColor(button.responseColor as ColorResolvable);
    }

    await interaction.reply({ embeds: [responseEmbed], flags: MessageFlags.Ephemeral });
  }
};
