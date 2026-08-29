import { Client, MessageFlags } from "discord.js";

import {
  Recruitment,
  RecruitmentDraft,
  RecruitmentSheetSnapshot,
  calculateRecruitmentPoints
} from "../../domain/types";
import { DragonsStore } from "../../storage/DragonsStore";
import { memberHasAnyRole } from "../../utils/discord";
import { logger } from "../../utils/logger";
import { ButtonHandler } from "../types";
import { buildRecruitmentMessage } from "./message";
import {
  buildRecruitmentVars,
  buildSheetSnapshot,
  selectedAreas,
  selectedRoleLabel
} from "./wizard";

export const SHEET_PREFIX = "recsheet:";

type SheetAction = "approve" | "reject";
type SheetState = "pending" | "queued" | "approved" | "rejected";

function sheetCustomId(action: SheetAction, recruitmentId: number): string {
  return `${SHEET_PREFIX}${action}:${recruitmentId}`;
}

/**
 * Monta a ficha num dos quatro estados. Le SEMPRE `recruitment.sheetPresentation`
 * (congelado no envio), nunca a configuracao viva — e o que mantem a ficha ja
 * postada no formato em que nasceu, inclusive nas edicoes posteriores.
 */
export async function buildSheetMessage(
  client: Client,
  recruitment: Recruitment,
  presentation: RecruitmentSheetSnapshot,
  state: SheetState,
  approverId: string | null
) {
  const [recruitUser, recruiterUser] = await Promise.all([
    client.users.fetch(recruitment.recruitUserId),
    client.users.fetch(recruitment.recruiterUserId)
  ]);

  const vars = buildRecruitmentVars({
    recruitUser,
    recruiterUser,
    roleLabel: recruitment.starterRoleLabel ?? "-",
    areasLabel: recruitment.areaLabels.join(", ") || "-",
    minAreas: 1,
    maxAreas: recruitment.areaLabels.length || 1,
    points: recruitment.points,
    approverId
  });

  const message =
    state === "pending"
      ? presentation.message
      : state === "queued"
        ? presentation.queued
        : state === "approved"
          ? presentation.approved
          : presentation.rejected;

  const buttons =
    state === "pending"
      ? [
          {
            customId: sheetCustomId("approve", recruitment.id),
            config: presentation.approveButton
          },
          { customId: sheetCustomId("reject", recruitment.id), config: presentation.rejectButton }
        ]
      : state === "queued"
        ? [
            {
              customId: sheetCustomId("approve", recruitment.id),
              config: presentation.approveButton,
              disabled: true
            }
          ]
        : state === "approved"
          ? [
              {
                customId: sheetCustomId("approve", recruitment.id),
                config: presentation.approvedButton,
                disabled: true
              }
            ]
          : [
              {
                customId: sheetCustomId("reject", recruitment.id),
                config: presentation.rejectedButton,
                disabled: true
              }
            ];

  return buildRecruitmentMessage({
    message,
    vars,
    buttons,
    avatarUrl: recruitUser.displayAvatarURL({ size: 256 }),
    avatarPlacement: presentation.avatarPlacement
  });
}

/** Reescreve a ficha no canal, se ela ainda existir. */
export async function editSheetMessage(
  client: Client,
  store: DragonsStore,
  recruitment: Recruitment,
  state: SheetState,
  approverId: string | null
): Promise<void> {
  if (!recruitment.sheetChannelId || !recruitment.sheetMessageId || !recruitment.sheetPresentation) {
    return;
  }

  try {
    const channel = await client.channels.fetch(recruitment.sheetChannelId);
    if (!channel?.isTextBased()) {
      return;
    }
    const message = await channel.messages.fetch(recruitment.sheetMessageId);
    await message.edit(
      await buildSheetMessage(client, recruitment, recruitment.sheetPresentation, state, approverId)
    );
  } catch (error) {
    logger.error("recruitment.sheet_edit_failed", error, {
      guildId: recruitment.guildId,
      recruitmentId: recruitment.id,
      state,
      channelId: recruitment.sheetChannelId,
      messageId: recruitment.sheetMessageId
    });
  }
}

export type PostSheetResult =
  | { ok: true; draft: RecruitmentDraft; recruitment: Recruitment }
  | { ok: false; message: string };

/**
 * Fecha o wizard: cria o recrutamento com os snapshots do que foi escolhido,
 * posta a ficha no canal configurado e marca a entrada do membro como
 * pendente. Os pontos sao calculados aqui e gravados no recrutamento — mudar
 * a pontuacao no painel depois nao reescreve o que ja foi enviado.
 */
export async function postRecruitmentSheet(
  client: Client,
  store: DragonsStore,
  draft: RecruitmentDraft
): Promise<PostSheetResult> {
  const flowConfig = await store.getRecruitmentFlowConfig(draft.guildId);
  if (!flowConfig.sheet.channelId) {
    logger.warn("recruitment_config.missing", {
      guildId: draft.guildId,
      draftId: draft.id,
      reason: "sheet_channel_missing"
    });
    return { ok: false, message: flowConfig.notConfiguredMessage };
  }

  const areas = selectedAreas(draft);
  const roleOption = draft.presentation.starterRoles.find((role) => role.id === draft.starterRoleId);
  if (!roleOption) {
    return { ok: false, message: "O cargo escolhido nao existe mais na configuracao." };
  }

  const presentation = buildSheetSnapshot(flowConfig, {
    guildId: draft.guildId,
    draftId: draft.id
  });
  const points = calculateRecruitmentPoints(areas, flowConfig.pointsMode);

  const recruitment = await store.createRecruitment({
    guildId: draft.guildId,
    recruitUserId: draft.recruitUserId,
    recruiterUserId: draft.recruiterUserId,
    kind: draft.kind,
    starterRoleOptionId: roleOption.id,
    starterRoleId: roleOption.roleId,
    starterRoleLabel: roleOption.label,
    areaOptionIds: areas.map((area) => area.id),
    areaRoleIds: [...new Set(areas.flatMap((area) => area.roleIds))],
    areaLabels: areas.map((area) => area.label),
    points,
    sheetPresentation: presentation
  });

  const channel = await client.channels.fetch(flowConfig.sheet.channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    await store.deletePendingRecruitment(recruitment.id);
    logger.warn("recruitment.sheet_channel_not_found", {
      guildId: draft.guildId,
      draftId: draft.id,
      recruitmentId: recruitment.id,
      channelId: flowConfig.sheet.channelId
    });
    return { ok: false, message: "Nao encontrei o canal das fichas configurado no painel." };
  }

  const mention =
    presentation.mentionApprovers && flowConfig.approverRoleIds.length > 0
      ? flowConfig.approverRoleIds.map((roleId) => `<@&${roleId}>`).join(" ")
      : undefined;

  const message = await channel.send({
    ...(mention
      ? { content: mention, allowedMentions: { roles: flowConfig.approverRoleIds } }
      : {}),
    ...(await buildSheetMessage(client, recruitment, presentation, "pending", null))
  });

  await store.setRecruitmentSheetMessage(recruitment.id, message.channelId, message.id);
  const submitted = await store.markRecruitmentDraftSubmitted(draft.id, recruitment.id);

  const updatedEntry =
    draft.kind === "credit"
      ? await store.markMemberEntryCreditPending(
          draft.guildId,
          draft.recruitUserId,
          draft.recruiterUserId,
          recruitment.id
        )
      : await store.markMemberEntryRecruitmentPending(
          draft.guildId,
          draft.recruitUserId,
          draft.recruiterUserId,
          recruitment.id
        );

  logger.info("recruitment.sheet_sent", {
    guildId: draft.guildId,
    draftId: draft.id,
    recruitmentId: recruitment.id,
    kind: recruitment.kind,
    channelId: message.channelId,
    messageId: message.id,
    recruiterUserId: draft.recruiterUserId,
    recruitUserId: draft.recruitUserId,
    starterRoleId: roleOption.roleId,
    starterRoleLabel: roleOption.label,
    areaIds: areas.map((area) => area.id),
    areaRoleIds: recruitment.areaRoleIds,
    points,
    pointsMode: flowConfig.pointsMode,
    memberEntryUpdated: Boolean(updatedEntry)
  });

  return {
    ok: true,
    draft: submitted ?? { ...draft, status: "submitted", recruitmentId: recruitment.id },
    recruitment: {
      ...recruitment,
      sheetChannelId: message.channelId,
      sheetMessageId: message.id
    }
  };
}

/**
 * Botoes da ficha. `Confirmar` enfileira o job que aplica cargos e credita
 * pontos (mesma fila do fluxo antigo, que serializa as escritas); `Rejeitar`
 * e resolvido aqui mesmo, porque nao mexe em cargo nem em ponto.
 */
export const recruitmentSheetButtonHandler: ButtonHandler = {
  customIdPrefix: SHEET_PREFIX,

  async execute(interaction, { store }) {
    const [action, rawId] = interaction.customId.slice(SHEET_PREFIX.length).split(":");
    const recruitmentId = Number(rawId);
    if (!action || !Number.isInteger(recruitmentId)) {
      await interaction.reply({ content: "Ficha invalida.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const recruitment = await store.getRecruitment(recruitmentId);
    if (!recruitment) {
      await interaction.editReply("Recrutamento nao encontrado.");
      return;
    }

    const flowConfig = await store.getRecruitmentFlowConfig(recruitment.guildId);
    const guild = await interaction.client.guilds.fetch(recruitment.guildId).catch(() => null);
    const approver = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
    if (!guild || !approver) {
      await interaction.editReply("Nao consegui validar seu usuario no servidor.");
      return;
    }

    if (!memberHasAnyRole(approver, flowConfig.approverRoleIds)) {
      logger.warn("recruitment.sheet_blocked", {
        reason: "missing_approver_role",
        guildId: recruitment.guildId,
        recruitmentId,
        userId: approver.id,
        userTag: approver.user.tag,
        approverRoleIds: flowConfig.approverRoleIds
      });
      await interaction.editReply(flowConfig.notApproverMessage);
      return;
    }

    if (recruitment.status !== "pending") {
      await interaction.editReply(
        recruitment.status === "approved"
          ? "Este recrutamento ja foi aprovado."
          : "Este recrutamento ja foi rejeitado."
      );
      return;
    }

    if (action === "reject") {
      const rejected = await store.rejectRecruitment(recruitmentId, approver.id);
      if (!rejected) {
        await interaction.editReply("Este recrutamento ja foi resolvido por outra pessoa.");
        return;
      }

      await store.markMemberEntryRecruitmentRejected(
        rejected.guildId,
        rejected.recruitUserId,
        approver.id
      );
      await editSheetMessage(interaction.client, store, rejected, "rejected", approver.id);

      logger.info("recruitment.rejected", {
        guildId: rejected.guildId,
        recruitmentId,
        kind: rejected.kind,
        approverUserId: approver.id,
        approverUserTag: approver.user.tag,
        recruiterUserId: rejected.recruiterUserId,
        recruitUserId: rejected.recruitUserId
      });
      await interaction.editReply("Recrutamento rejeitado.");
      return;
    }

    const job = await store.enqueueMemberActionJob({
      type: "approve_recruitment",
      guildId: recruitment.guildId,
      userId: recruitment.recruitUserId,
      requestedByUserId: approver.id,
      recruitmentId: recruitment.id
    });
    await editSheetMessage(interaction.client, store, recruitment, "queued", approver.id);

    logger.info("recruitment.approval_enqueued", {
      guildId: recruitment.guildId,
      jobId: job.job.id,
      created: job.created,
      recruitmentId,
      kind: recruitment.kind,
      approverUserId: approver.id,
      approverUserTag: approver.user.tag,
      recruiterUserId: recruitment.recruiterUserId,
      recruitUserId: recruitment.recruitUserId
    });

    await interaction.editReply(
      job.created ? "Aprovacao enfileirada." : "Esta aprovacao ja esta na fila."
    );
  }
};
