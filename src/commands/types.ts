import {
  ButtonInteraction,
  ChatInputCommandInteraction,
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
