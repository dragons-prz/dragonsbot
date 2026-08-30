import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from "discord.js";
import { DragonsStore } from "../storage/DragonsStore";

export interface CommandContext {
  store: DragonsStore;
}

export interface SlashCommand {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
}

export interface ButtonHandler {
  customIdPrefix: string;
  execute(interaction: ButtonInteraction, context: CommandContext): Promise<void>;
}

export interface SelectMenuHandler {
  customIdPrefix: string;
  execute(interaction: StringSelectMenuInteraction, context: CommandContext): Promise<void>;
}

export interface ModalHandler {
  customIdPrefix: string;
  execute(interaction: ModalSubmitInteraction, context: CommandContext): Promise<void>;
}
