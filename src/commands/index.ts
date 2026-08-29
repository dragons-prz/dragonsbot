import { blacklistCommand } from "./blacklist";
import { configCommand } from "./config";
import { painelCommand, panelButtonHandler, panelSelectHandler } from "./painel";
import { pontosCommand } from "./pontos";
import { pontosDarCommand } from "./pontos-dar";
import { rankingCommand } from "./ranking";
import { approveRecruitmentButton, verificarCommand, verifyMemberButton } from "./recrutar";
import { recruitmentSheetButtonHandler } from "./recruitment/sheet";
import {
  recrutarCommand,
  recruitmentWizardButtonHandler,
  recruitmentWizardSelectHandler
} from "./recruitment/wizard";
import { ticketActionButtonHandler } from "./ticket-actions";
import { ButtonHandler, SelectMenuHandler, SlashCommand } from "./types";

export const commands: SlashCommand[] = [
  configCommand,
  recrutarCommand,
  verificarCommand,
  pontosCommand,
  pontosDarCommand,
  rankingCommand,
  painelCommand,
  blacklistCommand
];
export const buttonHandlers: ButtonHandler[] = [
  // `recruitment:approve:` (fluxo antigo, por DM) fica registrado enquanto
  // houver aprovacoes pendentes nas DMs dos founders.
  approveRecruitmentButton,
  verifyMemberButton,
  recruitmentWizardButtonHandler,
  recruitmentSheetButtonHandler,
  panelButtonHandler,
  ticketActionButtonHandler
];
export const selectMenuHandlers: SelectMenuHandler[] = [
  recruitmentWizardSelectHandler,
  panelSelectHandler
];
