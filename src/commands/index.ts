import { blacklistCommand } from "./blacklist";
import { configCommand } from "./config";
import { painelCommand, panelButtonHandler, panelSelectHandler } from "./painel";
import { verificationTicketFormHandler } from "./panel-actions/verification-ticket";
import { pontosCommand } from "./pontos";
import { pontosDarCommand } from "./pontos-dar";
import { pontosResetarButtonHandler, pontosResetarCommand } from "./pontos-resetar";
import { rankingCommand } from "./ranking";
import { approveRecruitmentButton, verificarCommand, verifyMemberButton } from "./recrutar";
import { recruitmentSheetButtonHandler } from "./recruitment/sheet";
import {
  recrutarCommand,
  recruitmentWizardButtonHandler,
  recruitmentWizardSelectHandler
} from "./recruitment/wizard";
import { ticketActionButtonHandler } from "./ticket-actions";
import { ButtonHandler, ModalHandler, SelectMenuHandler, SlashCommand } from "./types";

export const commands: SlashCommand[] = [
  configCommand,
  recrutarCommand,
  verificarCommand,
  pontosCommand,
  pontosDarCommand,
  pontosResetarCommand,
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
  ticketActionButtonHandler,
  pontosResetarButtonHandler
];
export const selectMenuHandlers: SelectMenuHandler[] = [
  recruitmentWizardSelectHandler,
  panelSelectHandler
];
export const modalHandlers: ModalHandler[] = [verificationTicketFormHandler];
