import { configCommand } from "./config";
import { pontosCommand } from "./pontos";
import { rankingCommand } from "./ranking";
import { approveRecruitmentButton, recrutarCommand } from "./recrutar";
import { ButtonHandler, SlashCommand } from "./types";

export const commands: SlashCommand[] = [configCommand, recrutarCommand, pontosCommand, rankingCommand];
export const buttonHandlers: ButtonHandler[] = [approveRecruitmentButton];
