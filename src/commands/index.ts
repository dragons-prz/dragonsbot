import { configCommand } from "./config";
import { painelCommand, panelButtonHandler } from "./painel";
import { pontosCommand } from "./pontos";
import { rankingCommand } from "./ranking";
import { approveRecruitmentButton, recrutarCommand, verificarCommand, verifyMemberButton } from "./recrutar";
import { ButtonHandler, SlashCommand } from "./types";

export const commands: SlashCommand[] = [configCommand, recrutarCommand, verificarCommand, pontosCommand, rankingCommand, painelCommand];
export const buttonHandlers: ButtonHandler[] = [approveRecruitmentButton, verifyMemberButton, panelButtonHandler];
