import { AnyThreadChannel, ButtonInteraction, GuildMember, MessageFlags } from "discord.js";

import { SupportCategoryConfig, TicketRecord } from "../domain/types";
import { DragonsStore } from "../storage/DragonsStore";
import { memberHasAnyRole, renderTemplate } from "../utils/discord";
import { logger } from "../utils/logger";
import { buildTicketActionRow, TICKET_ACTION_PREFIX, TicketActionRowState } from "./ticket-shared";
import { ButtonHandler } from "./types";

/**
 * Botoes "Atender ticket" / "Fechar ticket" que acompanham a mensagem de
 * ping do suporte no topico de um ticket. `customId` =
 * `ticketact:<claim|close>:<ticketId>`. So membros com um cargo de suporte
 * da categoria podem acionar.
 */
export const ticketActionButtonHandler: ButtonHandler = {
  customIdPrefix: TICKET_ACTION_PREFIX,

  async execute(interaction, { store }) {
    const guildId = interaction.guildId;
    if (!guildId || !interaction.guild) {
      await interaction.reply({ content: "Estes botoes so funcionam dentro de um servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    const [, action, ticketId] = interaction.customId.split(":");
    const ticket = ticketId ? await store.getTicket(ticketId) : null;
    if (!ticket || ticket.guildId !== guildId) {
      await interaction.reply({ content: "Este ticket nao foi encontrado.", flags: MessageFlags.Ephemeral });
      return;
    }

    const member = interaction.member;

    // Ticket de verificacao: sem categoria de suporte; quem Atende/Fecha e o
    // cargo `recruiter`.
    if (ticket.kind === "verification") {
      const guildConfig = await store.getGuildConfig(guildId);
      const isRecruiter =
        member instanceof GuildMember && memberHasAnyRole(member, [guildConfig.recruiterRoleId]);
      if (!isRecruiter) {
        await interaction.reply({
          content: "Apenas a equipe de Recrutamento pode usar estes botoes.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (action === "claim") {
        await handleClaim(interaction, store, ticket, null);
        return;
      }
      if (action === "close") {
        await handleClose(interaction, store, ticket, null);
        return;
      }
      await interaction.reply({ content: "Acao de ticket nao reconhecida.", flags: MessageFlags.Ephemeral });
      return;
    }

    const category = await store.getSupportCategory(guildId, ticket.categoryId);
    const isSupport =
      member instanceof GuildMember && !!category && memberHasAnyRole(member, category.supportRoleIds);
    if (!isSupport) {
      await interaction.reply({ content: "Apenas o suporte pode usar estes botoes.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === "claim") {
      await handleClaim(interaction, store, ticket, category);
      return;
    }
    if (action === "close") {
      await handleClose(interaction, store, ticket, category);
      return;
    }

    await interaction.reply({ content: "Acao de ticket nao reconhecida.", flags: MessageFlags.Ephemeral });
  }
};

async function fetchThread(
  interaction: ButtonInteraction,
  threadId: string
): Promise<AnyThreadChannel | null> {
  const channel = await interaction.guild!.channels.fetch(threadId).catch(() => null);
  return channel && channel.isThread() ? channel : null;
}

async function editPingButtons(
  thread: AnyThreadChannel,
  pingMessageId: string,
  ticketId: string,
  state: TicketActionRowState
): Promise<void> {
  try {
    const message = await thread.messages.fetch(pingMessageId);
    await message.edit({ components: [buildTicketActionRow(ticketId, state)] });
  } catch (error) {
    logger.warn("ticket.ping_edit_failed", { ticketId, pingMessageId, error: String(error) });
  }
}

async function handleClaim(
  interaction: ButtonInteraction,
  store: DragonsStore,
  ticket: TicketRecord,
  category: SupportCategoryConfig | null
): Promise<void> {
  if (ticket.status === "closed") {
    await interaction.reply({ content: "Este ticket ja foi fechado.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (ticket.status === "claimed") {
    const mine = ticket.claimedByUserId === interaction.user.id;
    await interaction.reply({
      content: mine ? "Voce ja esta atendendo este ticket." : `Este ticket ja esta sendo atendido por <@${ticket.claimedByUserId}>.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { users: [] }
    });
    return;
  }

  const result = await store.claimTicket(ticket.id, interaction.user.id);
  if (!result || result.claimedByUserId !== interaction.user.id) {
    await interaction.reply({
      content: result?.claimedByUserId
        ? `Este ticket ja esta sendo atendido por <@${result.claimedByUserId}>.`
        : "Nao foi possivel assumir este ticket agora.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { users: [] }
    });
    return;
  }

  const thread = await fetchThread(interaction, ticket.threadId);
  if (thread) {
    const body = renderTemplate(category?.claimMessage || "{claimer} esta atendendo o ticket de {user}.", {
      user: `<@${ticket.openerUserId}>`,
      claimer: `<@${interaction.user.id}>`
    });
    await thread.send({ content: body, allowedMentions: { users: [] } }).catch(() => undefined);
    await editPingButtons(thread, ticket.pingMessageId, ticket.id, { claimDisabled: true, closeDisabled: false });
  }

  logger.info("ticket.claimed", {
    guildId: ticket.guildId,
    ticketId: ticket.id,
    categoryId: ticket.categoryId,
    claimedByUserId: interaction.user.id
  });
  await interaction.reply({ content: "Voce assumiu este ticket.", flags: MessageFlags.Ephemeral });
}

async function handleClose(
  interaction: ButtonInteraction,
  store: DragonsStore,
  ticket: TicketRecord,
  category: SupportCategoryConfig | null
): Promise<void> {
  if (ticket.status === "closed") {
    await interaction.reply({ content: "Este ticket ja foi fechado.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await store.closeTicket(ticket.id, interaction.user.id);
  if (!result) {
    await interaction.editReply({ content: "Nao foi possivel fechar este ticket agora." });
    return;
  }

  await store.releaseTicketSlot(ticket.guildId, ticket.openerUserId).catch(() => undefined);

  // Ticket de verificacao usa o template de `verificationTicket.closeMessage`.
  let closeTemplate = category?.closeMessage || "Ticket fechado por {closer}.";
  if (!category && ticket.kind === "verification") {
    const flowConfig = await store.getRecruitmentFlowConfig(ticket.guildId);
    closeTemplate = flowConfig.verificationTicket.closeMessage;
  }

  const thread = await fetchThread(interaction, ticket.threadId);
  if (thread) {
    const body = renderTemplate(closeTemplate, {
      user: `<@${ticket.openerUserId}>`,
      closer: `<@${interaction.user.id}>`
    });
    await thread.send({ content: body, allowedMentions: { users: [] } }).catch(() => undefined);
    await editPingButtons(thread, ticket.pingMessageId, ticket.id, { claimDisabled: true, closeDisabled: true });

    if ((category?.closeAction ?? "archive-remove") === "archive-remove") {
      // Remover o autor e trancar/arquivar por ultimo, depois de todas as
      // mensagens/edicoes acima (um topico arquivado reabre ao receber
      // mensagem).
      await thread.members.remove(ticket.openerUserId).catch(() => undefined);
      await thread.setLocked(true).catch(() => undefined);
      await thread.setArchived(true).catch(() => undefined);
    }
  }

  logger.info("ticket.closed", {
    guildId: ticket.guildId,
    ticketId: ticket.id,
    categoryId: ticket.categoryId,
    closedByUserId: interaction.user.id
  });
  await interaction.editReply({ content: "Ticket fechado." });
}
