import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder
} from "discord.js";

import { getGuildId, memberHasAnyRole, requireGuildMember } from "../utils/discord";
import { logger } from "../utils/logger";
import { ButtonHandler, SlashCommand } from "./types";

const CONFIRM_PREFIX = "pontosreset:";
const RESET_REASON = "Reset de pontos pela administracao";

/** Cargos que podem resetar: `pointsResetRoleIds`, ou `pointsGrantRoleIds` se vazio. */
function resetRoleIds(flow: { pointsResetRoleIds: string[]; pointsGrantRoleIds: string[] }): string[] {
  return flow.pointsResetRoleIds.length > 0 ? flow.pointsResetRoleIds : flow.pointsGrantRoleIds;
}

/**
 * Zera os pontos totais de um membro (`usuario:`) ou de todos (`todos:True`,
 * com confirmacao por botao). So `points` volta a 0 — `recruitments` e o
 * historico ficam. Nenhum cargo e mexido (sem up automatico).
 */
export const pontosResetarCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("pontos-resetar")
    .setDescription("Zera os pontos totais de um membro ou de todos.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Membro que tera os pontos zerados.")
    )
    .addBooleanOption((option) =>
      option.setName("todos").setDescription("Zerar os pontos de TODOS os membros do servidor.")
    ),

  async execute(interaction, { store }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = getGuildId(interaction);
    const member = requireGuildMember(interaction);
    const flowConfig = await store.getRecruitmentFlowConfig(guildId);

    if (!memberHasAnyRole(member, resetRoleIds(flowConfig))) {
      logger.warn("points.reset_blocked", {
        reason: "missing_reset_role",
        guildId,
        byUserId: member.id
      });
      await interaction.editReply(flowConfig.notApproverMessage);
      return;
    }

    const targetUser = interaction.options.getUser("usuario");
    const all = interaction.options.getBoolean("todos") ?? false;

    if ((targetUser && all) || (!targetUser && !all)) {
      await interaction.editReply("Informe **um** membro em `usuario` **ou** `todos:True` — nao os dois.");
      return;
    }

    if (targetUser) {
      const after = await store.resetMemberPoints(guildId, targetUser.id, RESET_REASON);
      logger.info("points.reset", {
        guildId,
        byUserId: member.id,
        scope: "member",
        targetUserId: targetUser.id,
        affected: 1
      });
      await interaction.editReply(
        `Zerei os pontos de <@${targetUser.id}>. Total agora: **${after.points}** · Recrutamentos: **${after.recruitments}** (nao mexidos).`
      );
      return;
    }

    // `todos:True` — confirma antes de zerar o servidor inteiro.
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_PREFIX}confirm:${guildId}:${member.id}`)
        .setLabel("Confirmar reset geral")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_PREFIX}cancel:${guildId}:${member.id}`)
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.editReply({
      content:
        "Isto vai **zerar os pontos de todos os membros** do servidor. `recruitments` e o historico ficam. Confirmar?",
      components: [row]
    });
  }
};

export const pontosResetarButtonHandler: ButtonHandler = {
  customIdPrefix: CONFIRM_PREFIX,

  async execute(interaction, { store }) {
    const [, action, guildId, requesterId] = interaction.customId.split(":");
    if (!interaction.guildId || interaction.guildId !== guildId) {
      await interaction.reply({ content: "Acao invalida.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.user.id !== requesterId) {
      await interaction.reply({
        content: "Apenas quem rodou o comando pode confirmar.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (action === "cancel") {
      await interaction.update({ content: "Reset cancelado.", components: [] });
      return;
    }

    await interaction.update({ content: "Zerando os pontos de todos os membros...", components: [] });
    const affected = await store.resetAllMemberPoints(guildId, RESET_REASON);
    logger.info("points.reset", {
      guildId,
      byUserId: interaction.user.id,
      scope: "guild",
      affected
    });
    await interaction.editReply({
      content: `Pronto. Pontos zerados em **${affected}** perfil${affected === 1 ? "" : "s"}.`,
      components: []
    });
  }
};
