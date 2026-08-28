import { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";

import { DragonsStore } from "../../storage/DragonsStore";

/**
 * Contexto entregue a uma acao de painel (`PanelActionConfig` do tipo
 * `run`). A acao decide como responder a interacao — normalmente com
 * `deferReply({ flags: Ephemeral })` seguido de `editReply`, ja que pode
 * fazer varias chamadas ao Discord/Firestore.
 */
export interface PanelActionContext {
  interaction: ButtonInteraction | StringSelectMenuInteraction;
  store: DragonsStore;
  params: Record<string, string>;
  panelId: string;
}

export type PanelActionHandler = (context: PanelActionContext) => Promise<void>;
