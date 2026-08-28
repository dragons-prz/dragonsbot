import { MessageFlags } from "discord.js";

import { logger } from "../../utils/logger";
import { openSupportTicket } from "./support-ticket";
import { PanelActionContext, PanelActionHandler } from "./types";

/**
 * Registry das acoes `run` de painel. A chave e o `actionId` gravado no
 * documento do painel (espelho do `PANEL_ACTIONS` da dragons-platform).
 * Adicionar uma acao aqui e o unico ponto de acoplamento entre o painel
 * generico e a logica especifica (ex.: ticket de suporte).
 */
export const PANEL_ACTION_REGISTRY: Record<string, PanelActionHandler> = {
  "support-ticket": openSupportTicket
};

export async function runPanelAction(actionId: string, context: PanelActionContext): Promise<void> {
  const handler = PANEL_ACTION_REGISTRY[actionId];
  if (!handler) {
    logger.warn("panel.action_unknown", {
      guildId: context.interaction.guildId,
      panelId: context.panelId,
      actionId
    });
    await context.interaction.reply({
      content: "Esta acao nao esta mais disponivel. Avise a administracao.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await handler(context);
}
