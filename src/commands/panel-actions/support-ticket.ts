import { randomUUID } from "node:crypto";

import { ChannelType, GuildMember, MessageFlags } from "discord.js";

import { logger } from "../../utils/logger";
import { renderTemplate, slugify } from "../../utils/discord";
import { buildTicketActionRow, roleMentions } from "../ticket-shared";
import { PanelActionContext } from "./types";

const THREAD_NAME_MAX = 100;

/** Id de ticket (20 chars, estilo auto-id do Firestore) gerado antes de criar o topico. */
function newTicketId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 20);
}

/** Data no formato AAAAMMDD, usada como variavel `{date}` no nome do topico. */
function todayStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Acao `support-ticket`: abre um topico privado de atendimento para quem
 * acionou o painel.
 *
 * `params.category` referencia uma `supportCategories/{guildId}_{id}`
 * configurada pela dragons-platform. O bot so le essa config; toda a
 * mecanica (topico privado, ping do suporte, registro do ticket) mora aqui.
 */
export async function openSupportTicket({
  interaction,
  store,
  params,
  panelId
}: PanelActionContext): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const guildId = interaction.guildId;
  if (!guild || !guildId) {
    await interaction.editReply({ content: "Este painel so funciona dentro de um servidor." });
    return;
  }

  const categoryId = params.category;
  if (!categoryId) {
    logger.warn("ticket.open_denied", { guildId, panelId, reason: "missing_category_param" });
    await interaction.editReply({ content: "Esta opcao esta mal configurada. Avise a administracao." });
    return;
  }

  const category = await store.getSupportCategory(guildId, categoryId);
  if (!category) {
    logger.warn("ticket.open_denied", { guildId, panelId, categoryId, reason: "category_not_found" });
    await interaction.editReply({ content: "Esta opcao esta mal configurada. Avise a administracao." });
    return;
  }

  const parent = await guild.channels.fetch(category.parentChannelId).catch(() => null);
  if (!parent || parent.type !== ChannelType.GuildText) {
    logger.warn("ticket.open_denied", {
      guildId,
      panelId,
      categoryId,
      reason: "parent_channel_invalid",
      parentChannelId: category.parentChannelId
    });
    await interaction.editReply({ content: "Nao foi possivel abrir o ticket agora. Avise a administracao." });
    return;
  }

  // Trava de 1 ticket aberto por usuario: reserva ANTES de criar o topico
  // para nao vazar topicos orfaos se duas interacoes chegarem juntas.
  const slotClaimed = await store.claimTicketSlot(guildId, interaction.user.id);
  if (!slotClaimed) {
    logger.info("ticket.open_denied", { guildId, panelId, categoryId, userId: interaction.user.id, reason: "slot_taken" });
    await interaction.editReply({
      content: "Voce ja tem um ticket aberto. Aguarde o atendimento ou feche o ticket atual antes de abrir outro."
    });
    return;
  }

  try {
    const ticketId = newTicketId();
    const displayName =
      interaction.member instanceof GuildMember ? interaction.member.displayName : interaction.user.username;
    // `{user}` = nome de quem abriu (slug); `{date}` = AAAAMMDD; `{shortid}`
    // = prefixo do id do ticket (unicidade garantida). Variaveis nao usadas
    // no template ficam de fora sem quebrar.
    const threadName = renderTemplate(category.threadNameTemplate, {
      user: slugify(displayName, THREAD_NAME_MAX) || "ticket",
      date: todayStamp(),
      shortid: ticketId.slice(0, 4)
    }).slice(0, THREAD_NAME_MAX);

    const thread = await parent.threads.create({
      name: threadName,
      type: ChannelType.PrivateThread,
      invitable: false,
      reason: `Ticket de suporte: ${category.name}`
    });

    await thread.members.add(interaction.user.id).catch((error) => {
      logger.warn("ticket.opener_add_failed", { guildId, threadId: thread.id, error: String(error) });
    });

    const mentions = roleMentions(category.supportRoleIds, category.viewerRoleIds);
    const body = renderTemplate(category.openMessage, { user: `<@${interaction.user.id}>` });
    const pingMessage = await thread.send({
      content: mentions ? `${mentions}\n${body}` : body,
      allowedMentions: { roles: dedupe([...category.supportRoleIds, ...category.viewerRoleIds]), users: [] }
    });

    const ticket = await store.createTicket({
      id: ticketId,
      guildId,
      panelId,
      categoryId,
      openerUserId: interaction.user.id,
      parentChannelId: parent.id,
      threadId: thread.id,
      pingMessageId: pingMessage.id
    });

    await pingMessage.edit({ components: [buildTicketActionRow(ticket.id, { claimDisabled: false })] });

    logger.info("ticket.opened", {
      guildId,
      panelId,
      categoryId,
      ticketId: ticket.id,
      threadId: thread.id,
      openerUserId: interaction.user.id
    });

    await interaction.editReply({ content: `Ticket criado: <#${thread.id}>` });
  } catch (error) {
    // Nao conseguimos criar o topico/mensagem: devolve a trava para o
    // usuario poder tentar de novo.
    await store.releaseTicketSlot(guildId, interaction.user.id).catch(() => undefined);
    logger.error("ticket.open_failed", error, { guildId, panelId, categoryId, openerUserId: interaction.user.id });
    await interaction.editReply({ content: "Nao foi possivel abrir o ticket agora. Tente de novo em instantes." });
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
