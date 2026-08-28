import { blacklistCommand } from "./blacklist";
import { configCommand } from "./config";
import { painelCommand, panelButtonHandler, panelSelectHandler } from "./painel";
import { pontosCommand } from "./pontos";
import { rankingCommand } from "./ranking";
import { approveRecruitmentButton, recrutarCommand, verificarCommand, verifyMemberButton } from "./recrutar";
import { ticketActionButtonHandler } from "./ticket-actions";
import { ButtonHandler, SelectMenuHandler, SlashCommand } from "./types";

export const commands: SlashCommand[] = [configCommand, recrutarCommand, verificarCommand, pontosCommand, rankingCommand, painelCommand, blacklistCommand];
export const buttonHandlers: ButtonHandler[] = [
  approveRecruitmentButton,
  verifyMemberButton,
  panelButtonHandler,
  ticketActionButtonHandler
];
export const selectMenuHandlers: SelectMenuHandler[] = [panelSelectHandler];
