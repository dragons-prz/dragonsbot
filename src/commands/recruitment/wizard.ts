import {
  Client,
  MessageFlags,
  SlashCommandBuilder,
  User
} from "discord.js";

import {
  RecruitmentAreaOption,
  RecruitmentDraft,
  RecruitmentFlowConfig,
  RecruitmentPresentationSnapshot,
  RecruitmentSheetSnapshot,
  calculateRecruitmentPoints
} from "../../domain/types";
import { getGuildId, memberHasRole, requireGuildMember } from "../../utils/discord";
import { logger } from "../../utils/logger";
import { ButtonHandler, CommandContext, SelectMenuHandler, SlashCommand } from "../types";
import { buildRecruitmentMessage } from "./message";
import { postRecruitmentSheet } from "./sheet";

export const WIZARD_PREFIX = "rec:";

const TOTAL_STEPS = 3;
/** Rede de seguranca dos rascunhos abandonados (o TTL de cada um vem da config). */
const DRAFT_EXPIRY_TICK_MS = 60_000;

type WizardAction = "role" | "areas" | "back" | "cancel" | "restart" | "confirm";

function customId(action: WizardAction, draftId: string): string {
  return `${WIZARD_PREFIX}${action}:${draftId}`;
}

function parseCustomId(raw: string): { action: WizardAction; draftId: string } | null {
  const [action, draftId] = raw.slice(WIZARD_PREFIX.length).split(":");
  if (!action || !draftId) {
    return null;
  }
  return { action: action as WizardAction, draftId };
}

/**
 * Congela a apresentacao no momento do `/recrutar`.
 *
 * Duas coisas acontecem aqui e as duas sao deliberadas:
 *
 * 1. **Snapshot**: o wizard passa a se desenhar por esta copia, entao editar
 *    a configuracao no painel vale so para recrutamentos NOVOS.
 * 2. **Layout uniforme**: as tres etapas e os desfechos vivem na MESMA
 *    mensagem, editada a cada passo, e o Discord nao deixa editar uma
 *    mensagem alternando entre embed e Components V2. O layout da etapa 1
 *    manda em todas as mensagens do wizard; divergencia e normalizada aqui e
 *    logada, em vez de estourar na hora de editar.
 */
export function buildPresentationSnapshot(
  config: RecruitmentFlowConfig,
  logContext: Record<string, unknown>
): RecruitmentPresentationSnapshot {
  const layout = config.stepOne.message.layout;
  const messages = [
    config.stepTwo.message,
    config.stepThree.message,
    config.outcome.submitted,
    config.outcome.cancelled,
    config.outcome.expired
  ];
  if (messages.some((message) => message.layout !== layout)) {
    logger.warn("recruitment.layout_normalized", {
      layout,
      surface: "wizard",
      ...logContext
    });
  }

  return {
    stepOne: config.stepOne,
    stepTwo: { ...config.stepTwo, message: { ...config.stepTwo.message, layout } },
    stepThree: { ...config.stepThree, message: { ...config.stepThree.message, layout } },
    outcome: {
      submitted: { ...config.outcome.submitted, layout },
      cancelled: { ...config.outcome.cancelled, layout },
      expired: { ...config.outcome.expired, layout }
    },
    starterRoles: config.starterRoles,
    areas: config.areas,
    minAreas: config.minAreas,
    maxAreas: config.maxAreas,
    rolePendingText: config.rolePendingText,
    areasPendingText: config.areasPendingText,
    notDraftOwnerMessage: config.notDraftOwnerMessage
  };
}

/** Mesma ideia para a ficha, que e outra mensagem e por isso tem layout proprio. */
export function buildSheetSnapshot(
  config: RecruitmentFlowConfig,
  logContext: Record<string, unknown>
): RecruitmentSheetSnapshot {
  const layout = config.sheet.message.layout;
  const states = [config.sheet.queued, config.sheet.approved, config.sheet.rejected];
  if (states.some((message) => message.layout !== layout)) {
    logger.warn("recruitment.layout_normalized", {
      layout,
      surface: "sheet",
      ...logContext
    });
  }

  return {
    ...config.sheet,
    queued: { ...config.sheet.queued, layout },
    approved: { ...config.sheet.approved, layout },
    rejected: { ...config.sheet.rejected, layout }
  };
}

export function formatAccountCreatedAt(user: User): string {
  const seconds = Math.floor(user.createdTimestamp / 1000);
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

export interface RecruitmentVarsInput {
  step?: number;
  recruitUser: User;
  recruiterUser: User;
  roleLabel: string;
  areasLabel: string;
  minAreas: number;
  maxAreas: number;
  points: number;
  approverId?: string | null;
}

/** Valores de `{chave}` aceitos em titulo/descricao de qualquer mensagem do fluxo. */
export function buildRecruitmentVars(input: RecruitmentVarsInput): Record<string, string> {
  return {
    step: String(input.step ?? TOTAL_STEPS),
    total: String(TOTAL_STEPS),
    recruited: `<@${input.recruitUser.id}>`,
    recruitedId: input.recruitUser.id,
    recruitedTag: input.recruitUser.tag,
    recruiter: `<@${input.recruiterUser.id}>`,
    recruiterId: input.recruiterUser.id,
    recruiterTag: input.recruiterUser.tag,
    role: input.roleLabel,
    areas: input.areasLabel,
    min: String(input.minAreas),
    max: String(input.maxAreas),
    points: String(input.points),
    createdAt: formatAccountCreatedAt(input.recruitUser),
    approver: input.approverId ? `<@${input.approverId}>` : "-"
  };
}

export function selectedAreas(draft: RecruitmentDraft): RecruitmentAreaOption[] {
  return draft.presentation.areas.filter((area) => draft.areaIds.includes(area.id));
}

export function selectedRoleLabel(draft: RecruitmentDraft): string | null {
  return (
    draft.presentation.starterRoles.find((role) => role.id === draft.starterRoleId)?.label ?? null
  );
}

async function draftVars(
  client: Client,
  draft: RecruitmentDraft,
  step: number,
  pointsMode: "sum" | "highest" = "sum"
): Promise<Record<string, string>> {
  const [recruitUser, recruiterUser] = await Promise.all([
    client.users.fetch(draft.recruitUserId),
    client.users.fetch(draft.recruiterUserId)
  ]);
  const areas = selectedAreas(draft);
  return buildRecruitmentVars({
    step,
    recruitUser,
    recruiterUser,
    roleLabel: selectedRoleLabel(draft) ?? draft.presentation.rolePendingText,
    areasLabel:
      areas.length > 0
        ? areas.map((area) => area.label).join(", ")
        : draft.presentation.areasPendingText,
    minAreas: draft.presentation.minAreas,
    maxAreas: draft.presentation.maxAreas,
    points: calculateRecruitmentPoints(areas, pointsMode)
  });
}

/** Monta a mensagem da etapa atual do rascunho. */
export async function buildStepMessage(client: Client, draft: RecruitmentDraft) {
  const presentation = draft.presentation;

  if (draft.status === "selecting_role") {
    return buildRecruitmentMessage({
      message: presentation.stepOne.message,
      vars: await draftVars(client, draft, 1),
      select: {
        customId: customId("role", draft.id),
        placeholder: presentation.stepOne.select.placeholder,
        minValues: 1,
        maxValues: 1,
        options: presentation.starterRoles,
        selectedIds: draft.starterRoleId ? [draft.starterRoleId] : []
      },
      buttons: [
        { customId: customId("cancel", draft.id), config: presentation.stepOne.cancelButton }
      ]
    });
  }

  if (draft.status === "selecting_areas") {
    return buildRecruitmentMessage({
      message: presentation.stepTwo.message,
      vars: await draftVars(client, draft, 2),
      select: {
        customId: customId("areas", draft.id),
        placeholder: presentation.stepTwo.select.placeholder,
        minValues: presentation.minAreas,
        maxValues: presentation.maxAreas,
        options: presentation.areas,
        selectedIds: draft.areaIds
      },
      buttons: [
        { customId: customId("back", draft.id), config: presentation.stepTwo.backButton },
        { customId: customId("cancel", draft.id), config: presentation.stepTwo.cancelButton }
      ]
    });
  }

  return buildRecruitmentMessage({
    message: presentation.stepThree.message,
    vars: await draftVars(client, draft, 3),
    buttons: [
      { customId: customId("confirm", draft.id), config: presentation.stepThree.confirmButton },
      { customId: customId("restart", draft.id), config: presentation.stepThree.restartButton },
      { customId: customId("cancel", draft.id), config: presentation.stepThree.cancelButton }
    ]
  });
}

/** Mensagem final do wizard (sem componentes). */
async function buildOutcomeMessage(
  client: Client,
  draft: RecruitmentDraft,
  outcome: "submitted" | "cancelled" | "expired"
) {
  return buildRecruitmentMessage({
    message: draft.presentation.outcome[outcome],
    vars: await draftVars(client, draft, TOTAL_STEPS),
    buttons: []
  });
}

export const recrutarCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("recrutar")
    .setDescription("Inicia o recrutamento de um membro em 3 etapas.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Membro recrutado.").setRequired(true)
    ),

  async execute(interaction, { store }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = getGuildId(interaction);
    const recruiter = requireGuildMember(interaction);
    const config = await store.getGuildConfig(guildId);
    const flowConfig = await store.getRecruitmentFlowConfig(guildId);

    if (!memberHasRole(recruiter, config.recruiterRoleId)) {
      logger.warn("recruitment.draft_blocked", {
        reason: "missing_recruiter_role",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        requiredRoleId: config.recruiterRoleId
      });
      await interaction.editReply(flowConfig.notRecruiterMessage);
      return;
    }

    if (
      flowConfig.starterRoles.length === 0 ||
      flowConfig.areas.length === 0 ||
      !flowConfig.sheet.channelId
    ) {
      logger.warn("recruitment_config.missing", {
        guildId,
        recruiterUserId: recruiter.id,
        starterRoles: flowConfig.starterRoles.length,
        areas: flowConfig.areas.length,
        sheetChannelId: flowConfig.sheet.channelId
      });
      await interaction.editReply(flowConfig.notConfiguredMessage);
      return;
    }

    const recruitUser = interaction.options.getUser("usuario", true);
    logger.info("recruitment.requested", {
      guildId,
      recruiterUserId: recruiter.id,
      recruiterUserTag: recruiter.user.tag,
      recruitUserId: recruitUser.id,
      recruitUserTag: recruitUser.tag
    });

    const recruitMember = await interaction.guild!.members.fetch(recruitUser.id).catch(() => null);
    if (!recruitMember) {
      logger.warn("recruitment.draft_blocked", {
        reason: "recruit_not_in_guild",
        guildId,
        recruiterUserId: recruiter.id,
        recruitUserId: recruitUser.id
      });
      await interaction.editReply("O usuario informado nao esta no servidor.");
      return;
    }

    const blacklistEntry = await store.getBlacklistEntry(guildId, recruitUser.id);
    if (blacklistEntry) {
      logger.warn("recruitment.draft_blocked", {
        reason: "blacklisted",
        guildId,
        recruiterUserId: recruiter.id,
        recruitUserId: recruitUser.id,
        blacklistReason: blacklistEntry.reason
      });
      await interaction.editReply(
        `⚠️ Este usuario esta na blacklist e nao pode ser recrutado. Motivo: ${blacklistEntry.reason}`
      );
      return;
    }

    const pending = await store.findPendingRecruitmentByUser(guildId, recruitUser.id);
    if (pending) {
      logger.warn("recruitment.draft_blocked", {
        reason: "pending_exists",
        guildId,
        recruitmentId: pending.id,
        recruiterUserId: recruiter.id,
        recruitUserId: recruitUser.id
      });
      await interaction.editReply(
        `Ja existe um recrutamento pendente para este usuario (#${pending.id}).`
      );
      return;
    }

    // Quem ja e membro tambem pode ser recrutado de novo — por exemplo para
    // uma area nova (Recrutamento, Passtime, Suporte), sem ser a familia. A
    // aprovacao da gerencia na ficha e a unica trava necessaria: nao ha mais
    // janela de tempo nem exigencia de entrada registrada pelo bot, e a
    // mesma pessoa pode ser recrutada mais de uma vez para areas diferentes.
    const recruitAlreadyMember = recruitMember.roles.cache.has(config.memberRoleId);
    const kind = recruitAlreadyMember ? "credit" : "standard";

    const draft = await store.createRecruitmentDraft({
      guildId,
      channelId: interaction.channelId,
      recruiterUserId: recruiter.id,
      recruitUserId: recruitUser.id,
      kind,
      presentation: buildPresentationSnapshot(flowConfig, {
        guildId,
        recruiterUserId: recruiter.id
      }),
      ttlMinutes: flowConfig.draftTtlMinutes
    });

    const channel = interaction.channel;
    if (!channel?.isTextBased() || !("send" in channel)) {
      await store.cancelRecruitmentDraft(draft.id);
      await interaction.editReply("Nao consigo enviar mensagens neste canal.");
      return;
    }

    const message = await channel.send(await buildStepMessage(interaction.client, draft));
    await store.setRecruitmentDraftMessage(draft.id, message.channelId, message.id);

    logger.info("recruitment.draft_created", {
      guildId,
      draftId: draft.id,
      kind,
      channelId: message.channelId,
      messageId: message.id,
      recruiterUserId: recruiter.id,
      recruiterUserTag: recruiter.user.tag,
      recruitUserId: recruitUser.id,
      recruitUserTag: recruitUser.tag,
      ttlMinutes: flowConfig.draftTtlMinutes
    });

    await interaction.editReply(`Recrutamento de <@${recruitUser.id}> iniciado aqui no canal.`);
  }
};

/** Guarda comum dos componentes: rascunho existe, esta aberto e e do autor. */
async function resolveDraft(
  interaction: { customId: string; user: { id: string } },
  context: CommandContext
): Promise<
  | { ok: true; draft: RecruitmentDraft; action: WizardAction }
  | { ok: false; message: string }
> {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) {
    return { ok: false, message: "Recrutamento invalido." };
  }

  const draft = await context.store.getRecruitmentDraft(parsed.draftId);
  if (!draft) {
    return { ok: false, message: "Este recrutamento nao existe mais." };
  }

  if (draft.recruiterUserId !== interaction.user.id) {
    return { ok: false, message: draft.presentation.notDraftOwnerMessage };
  }

  if (draft.status === "submitted" || draft.status === "cancelled" || draft.status === "expired") {
    return { ok: false, message: "Este recrutamento ja foi encerrado." };
  }

  if (new Date(draft.expiresAt).getTime() <= Date.now()) {
    return { ok: false, message: "Este recrutamento expirou. Rode `/recrutar` de novo." };
  }

  return { ok: true, draft, action: parsed.action };
}

export const recruitmentWizardSelectHandler: SelectMenuHandler = {
  customIdPrefix: WIZARD_PREFIX,

  async execute(interaction, context) {
    const resolved = await resolveDraft(interaction, context);
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.message, flags: MessageFlags.Ephemeral });
      return;
    }

    const { draft, action } = resolved;
    const { store } = context;

    if (action === "role") {
      const starterRoleId = interaction.values[0];
      const updated = await store.updateRecruitmentDraftSelection(draft.id, {
        starterRoleId,
        status: "selecting_areas"
      });
      if (!updated) {
        await interaction.reply({
          content: "Este recrutamento ja foi encerrado.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      logger.info("recruitment.draft_role_selected", {
        guildId: draft.guildId,
        draftId: draft.id,
        starterRoleId,
        recruiterUserId: draft.recruiterUserId
      });
      await interaction.update(await buildStepMessage(interaction.client, updated));
      return;
    }

    if (action === "areas") {
      const areaIds = interaction.values;
      const updated = await store.updateRecruitmentDraftSelection(draft.id, {
        areaIds,
        status: "confirming"
      });
      if (!updated) {
        await interaction.reply({
          content: "Este recrutamento ja foi encerrado.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      logger.info("recruitment.draft_areas_selected", {
        guildId: draft.guildId,
        draftId: draft.id,
        areaIds,
        recruiterUserId: draft.recruiterUserId
      });
      await interaction.update(await buildStepMessage(interaction.client, updated));
      return;
    }

    await interaction.reply({ content: "Acao nao reconhecida.", flags: MessageFlags.Ephemeral });
  }
};

export const recruitmentWizardButtonHandler: ButtonHandler = {
  customIdPrefix: WIZARD_PREFIX,

  async execute(interaction, context) {
    const resolved = await resolveDraft(interaction, context);
    if (!resolved.ok) {
      await interaction.reply({ content: resolved.message, flags: MessageFlags.Ephemeral });
      return;
    }

    const { draft, action } = resolved;
    const { store } = context;

    if (action === "cancel") {
      const cancelled = await store.cancelRecruitmentDraft(draft.id);
      if (!cancelled) {
        await interaction.reply({
          content: "Este recrutamento ja foi encerrado.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      logger.info("recruitment.draft_cancelled", {
        guildId: draft.guildId,
        draftId: draft.id,
        recruiterUserId: draft.recruiterUserId,
        recruitUserId: draft.recruitUserId
      });
      await interaction.update(await buildOutcomeMessage(interaction.client, cancelled, "cancelled"));
      return;
    }

    if (action === "back") {
      const updated = await store.updateRecruitmentDraftSelection(draft.id, {
        status: "selecting_role"
      });
      if (updated) {
        logger.info("recruitment.draft_back", {
          guildId: draft.guildId,
          draftId: draft.id,
          recruiterUserId: draft.recruiterUserId
        });
        await interaction.update(await buildStepMessage(interaction.client, updated));
      }
      return;
    }

    if (action === "restart") {
      // Zera as selecoes, mantendo o snapshot: quem quiser o formato novo
      // cancela e roda `/recrutar` de novo.
      const updated = await store.updateRecruitmentDraftSelection(draft.id, {
        starterRoleId: null,
        areaIds: [],
        status: "selecting_role"
      });
      if (updated) {
        logger.info("recruitment.draft_restarted", {
          guildId: draft.guildId,
          draftId: draft.id,
          recruiterUserId: draft.recruiterUserId
        });
        await interaction.update(await buildStepMessage(interaction.client, updated));
      }
      return;
    }

    if (action === "confirm") {
      if (!draft.starterRoleId || draft.areaIds.length === 0) {
        await interaction.reply({
          content: "Escolha o cargo e as areas antes de confirmar.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.deferUpdate();
      const submitted = await postRecruitmentSheet(interaction.client, store, draft);
      if (!submitted.ok) {
        await interaction.followUp({ content: submitted.message, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.editReply(
        await buildOutcomeMessage(interaction.client, submitted.draft, "submitted")
      );
      return;
    }

    await interaction.reply({ content: "Acao nao reconhecida.", flags: MessageFlags.Ephemeral });
  }
};

/**
 * Fecha rascunhos abandonados: marca `expired` e troca a mensagem do wizard
 * pelo texto configurado, para nao ficar um dropdown vivo que nao responde.
 */
export function startRecruitmentDraftExpiryWorker(
  client: Client,
  store: CommandContext["store"]
): () => void {
  const tick = async () => {
    const expired = await store.expireStaleRecruitmentDrafts();
    for (const draft of expired) {
      logger.info("recruitment.draft_expired", {
        guildId: draft.guildId,
        draftId: draft.id,
        recruiterUserId: draft.recruiterUserId,
        recruitUserId: draft.recruitUserId
      });

      if (!draft.messageId) {
        continue;
      }

      try {
        const channel = await client.channels.fetch(draft.channelId);
        if (!channel?.isTextBased()) {
          continue;
        }
        const message = await channel.messages.fetch(draft.messageId);
        await message.edit(await buildOutcomeMessage(client, draft, "expired"));
      } catch (error) {
        logger.error("recruitment.draft_expire_edit_failed", error, {
          guildId: draft.guildId,
          draftId: draft.id,
          channelId: draft.channelId,
          messageId: draft.messageId
        });
      }
    }
  };

  const timer = setInterval(() => {
    void tick().catch((error) => {
      logger.error("recruitment.draft_expiry_failed", error);
    });
  }, DRAFT_EXPIRY_TICK_MS);

  return () => clearInterval(timer);
}
