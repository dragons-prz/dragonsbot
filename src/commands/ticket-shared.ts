import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

/** Prefixo dos `customId` dos botoes de acao de um ticket (`ticketact:<acao>:<ticketId>`). */
export const TICKET_ACTION_PREFIX = "ticketact:";

export interface TicketActionRowState {
  /** Desabilita "Atender ticket" (ticket ja atendido ou fechado). */
  claimDisabled: boolean;
  /** Desabilita "Fechar ticket" (ticket ja fechado). */
  closeDisabled?: boolean;
}

/**
 * Linha com os botoes "Atender ticket" / "Fechar ticket" que acompanha a
 * mensagem de ping do suporte no topico do ticket.
 */
export function buildTicketActionRow(
  ticketId: string,
  state: TicketActionRowState
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_ACTION_PREFIX}claim:${ticketId}`)
      .setLabel("Atender ticket")
      .setStyle(ButtonStyle.Success)
      .setDisabled(state.claimDisabled),
    new ButtonBuilder()
      .setCustomId(`${TICKET_ACTION_PREFIX}close:${ticketId}`)
      .setLabel("Fechar ticket")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(state.closeDisabled ?? false)
  );
}

/** Menções `<@&id>` dos cargos, sem duplicatas, na ordem suporte + visualizadores. */
export function roleMentions(supportRoleIds: readonly string[], viewerRoleIds: readonly string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const roleId of [...supportRoleIds, ...viewerRoleIds]) {
    if (roleId && !seen.has(roleId)) {
      seen.add(roleId);
      parts.push(`<@&${roleId}>`);
    }
  }
  return parts.join(" ");
}
