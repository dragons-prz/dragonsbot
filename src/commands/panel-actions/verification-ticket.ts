import { randomUUID } from "node:crypto";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GuildMember,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

import { logger } from "../../utils/logger";
import { renderTemplate, slugify } from "../../utils/discord";
import { DragonsStore } from "../../storage/DragonsStore";
import { TICKET_ACTION_PREFIX } from "../ticket-shared";
import { ModalHandler } from "../types";
import { PanelActionContext } from "./types";

const THREAD_NAME_MAX = 100;
/** `verifyrec:form:{guildId}` — o modal "Verificar-se". */
export const VERIFICATION_FORM_PREFIX = "verifyrec:form:";
const NONE_VALUE = "none";
/** 25 e o limite de opcoes de um select do Discord; deixa 1 para o "Nenhum". */
const MAX_RECRUITER_OPTIONS = 24;
const ESCALATION_TICK_MS = 60_000;
const AGE_FIELD = "age";
const RECRUITER_FIELD = "recruiter";

function newTicketId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 20);
}

function todayStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

/** Linha so com "Fechar ticket" — o ticket de verificacao nao tem "Atender". */
function verificationCloseRow(ticketId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_ACTION_PREFIX}close:${ticketId}`)
      .setLabel("Fechar ticket")
      .setStyle(ButtonStyle.Danger)
  );
}

/**
 * Acao `verification-ticket`: o botao "Verificar-se" de um painel. Abre um
 * MODAL do Discord com dois campos — Idade (texto) e "Veio por alguem?"
 * (dropdown com os membros do cargo `recruiter` + "Nenhum"). A thread do
 * ticket so nasce quando o membro envia o formulario
 * (`verificationTicketFormHandler`).
 */
export async function openVerificationTicket({
  interaction,
  store,
  panelId
}: PanelActionContext): Promise<void> {
  const guild = interaction.guild;
  const guildId = interaction.guildId;

  // `showModal` precisa ser a resposta INICIAL — nao da para `deferReply`
  // antes. So o botao (`ButtonInteraction`) abre modal.
  if (!interaction.isButton()) {
    await interaction.reply({
      content: "Acao invalida.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!guild || !guildId) {
    await interaction.reply({
      content: "Este painel so funciona dentro de um servidor.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const flowConfig = await store.getRecruitmentFlowConfig(guildId);
  const ticketConfig = flowConfig.verificationTicket;
  if (!ticketConfig.parentChannelId) {
    logger.warn("verification_ticket.open_denied", {
      guildId,
      panelId,
      reason: "parent_channel_not_configured"
    });
    await interaction.reply({
      content: "A verificacao ainda nao foi configurada. Avise a administracao.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const guildConfig = await store.getGuildConfig(guildId);
  // Popula o cache de membros para `role.members` nao vir vazio logo apos o
  // start do bot. Poucas centenas de membros, no maximo ~20 recrutadores.
  await guild.members.fetch().catch(() => undefined);
  const recruiterRole = await guild.roles.fetch(guildConfig.recruiterRoleId).catch(() => null);
  const recruiters = recruiterRole
    ? [...recruiterRole.members.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
    : [];

  if (recruiters.length > MAX_RECRUITER_OPTIONS) {
    logger.warn("verification_ticket.recruiter_list_truncated", {
      guildId,
      panelId,
      total: recruiters.length
    });
  }

  const ageInput = new TextInputBuilder()
    .setCustomId(AGE_FIELD)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(3)
    .setPlaceholder(ticketConfig.agePlaceholder.slice(0, 100));

  const recruiterSelect = new StringSelectMenuBuilder()
    .setCustomId(RECRUITER_FIELD)
    .setPlaceholder(ticketConfig.recruiterPickerPlaceholder.slice(0, 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      ...recruiters.slice(0, MAX_RECRUITER_OPTIONS).map((member) => ({
        label: member.displayName.slice(0, 100),
        value: member.id
      })),
      { label: ticketConfig.noRecruiterLabel.slice(0, 100), value: NONE_VALUE }
    );

  const modal = new ModalBuilder()
    .setCustomId(`${VERIFICATION_FORM_PREFIX}${guildId}`)
    .setTitle(ticketConfig.formTitle.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(ticketConfig.ageLabel.slice(0, 45))
        .setTextInputComponent(ageInput),
      new LabelBuilder()
        .setLabel(ticketConfig.recruiterPickerLabel.slice(0, 45))
        .setStringSelectMenuComponent(recruiterSelect)
    );

  await interaction.showModal(modal);
}

/**
 * Envio do modal "Verificar-se": cria a thread privada do ticket. Recrutador
 * escolhido -> a thread menciona so ele e escala para o cargo inteiro
 * depois de `escalateAfterMinutes`. "Nenhum" -> a thread ja menciona o
 * cargo `recruiter` e nao escala.
 */
export const verificationTicketFormHandler: ModalHandler = {
  customIdPrefix: VERIFICATION_FORM_PREFIX,

  async execute(interaction, { store }) {
    const guild = interaction.guild;
    const guildId = interaction.guildId;
    if (!guild || !guildId) {
      await interaction.reply({
        content: "Isto so funciona dentro de um servidor.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const age = interaction.fields.getTextInputValue(AGE_FIELD).trim();
    const recruiterChoice = interaction.fields.getStringSelectValues(RECRUITER_FIELD)[0] ?? NONE_VALUE;
    const declaredRecruiterUserId = recruiterChoice === NONE_VALUE ? null : recruiterChoice;

    const slotClaimed = await store.claimTicketSlot(guildId, interaction.user.id);
    if (!slotClaimed) {
      await interaction.editReply({
        content:
          "Voce ja tem um ticket aberto. Aguarde o atendimento ou feche o ticket atual antes de abrir outro."
      });
      return;
    }

    try {
      const flowConfig = await store.getRecruitmentFlowConfig(guildId);
      const ticketConfig = flowConfig.verificationTicket;
      const guildConfig = await store.getGuildConfig(guildId);

      const parent = ticketConfig.parentChannelId
        ? await guild.channels.fetch(ticketConfig.parentChannelId).catch(() => null)
        : null;
      if (!parent || parent.type !== ChannelType.GuildText) {
        await store.releaseTicketSlot(guildId, interaction.user.id).catch(() => undefined);
        await interaction.editReply({
          content: "Nao foi possivel abrir a verificacao agora. Avise a administracao."
        });
        return;
      }

      const ticketId = newTicketId();
      const displayName =
        interaction.member instanceof GuildMember
          ? interaction.member.displayName
          : interaction.user.username;
      const threadName = renderTemplate(ticketConfig.threadNameTemplate, {
        user: slugify(displayName, THREAD_NAME_MAX) || "membro",
        date: todayStamp(),
        shortid: ticketId.slice(0, 4)
      }).slice(0, THREAD_NAME_MAX);

      const thread = await parent.threads.create({
        name: threadName,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: "Ticket de verificacao"
      });

      await thread.members.add(interaction.user.id).catch((error) => {
        logger.warn("verification_ticket.opener_add_failed", {
          guildId,
          threadId: thread.id,
          error: String(error)
        });
      });

      const body = renderTemplate(ticketConfig.openMessage, {
        user: `<@${interaction.user.id}>`,
        recruiter: declaredRecruiterUserId ? `<@${declaredRecruiterUserId}>` : "-"
      });
      const answers = [
        `**${ticketConfig.ageLabel}:** ${age || "-"}`,
        `**${ticketConfig.recruiterPickerLabel}** ${
          declaredRecruiterUserId ? `<@${declaredRecruiterUserId}>` : ticketConfig.noRecruiterLabel
        }`
      ].join("\n");
      const mention = declaredRecruiterUserId
        ? `<@${declaredRecruiterUserId}>`
        : `<@&${guildConfig.recruiterRoleId}>`;
      const pingMessage = await thread.send({
        content: `${mention}\n${body}\n\n${answers}`,
        allowedMentions: declaredRecruiterUserId
          ? { users: [declaredRecruiterUserId] }
          : { roles: [guildConfig.recruiterRoleId] }
      });
      await pingMessage.edit({ components: [verificationCloseRow(ticketId)] });

      const escalateAt = declaredRecruiterUserId
        ? new Date(Date.now() + ticketConfig.escalateAfterMinutes * 60_000).toISOString()
        : null;

      await store.createTicket({
        id: ticketId,
        guildId,
        panelId: "",
        openerUserId: interaction.user.id,
        parentChannelId: parent.id,
        threadId: thread.id,
        pingMessageId: pingMessage.id,
        kind: "verification",
        declaredRecruiterUserId,
        escalateAt
      });

      logger.info("verification_ticket.opened", {
        guildId,
        ticketId,
        threadId: thread.id,
        openerUserId: interaction.user.id,
        declaredRecruiterUserId,
        escalates: escalateAt !== null
      });

      await interaction.editReply({ content: `Ticket criado: <#${thread.id}>` });
    } catch (error) {
      await store.releaseTicketSlot(guildId, interaction.user.id).catch(() => undefined);
      logger.error("verification_ticket.open_failed", error, {
        guildId,
        openerUserId: interaction.user.id
      });
      await interaction.editReply({
        content: "Nao foi possivel abrir a verificacao agora. Tente de novo em instantes."
      });
    }
  }
};

/**
 * Rede de seguranca dos tickets de verificacao "por recrutador": se em
 * `escalateAfterMinutes` o membro nao foi recrutado, marca o cargo
 * `recruiter` inteiro na thread. Roda como `setInterval` (volume baixo,
 * sem observador).
 */
export function startVerificationTicketEscalationWorker(
  client: Client,
  store: DragonsStore
): () => void {
  const tick = async () => {
    const due = await store.listTicketsToEscalate(new Date().toISOString());
    for (const ticket of due) {
      try {
        const thread = await client.channels.fetch(ticket.threadId).catch(() => null);
        if (!thread || !thread.isThread()) {
          await store.markTicketEscalated(ticket.id);
          continue;
        }
        const guildConfig = await store.getGuildConfig(ticket.guildId);
        const flowConfig = await store.getRecruitmentFlowConfig(ticket.guildId);
        const body = renderTemplate(flowConfig.verificationTicket.escalationMessage, {
          user: `<@${ticket.openerUserId}>`
        });
        await thread
          .send({
            content: `<@&${guildConfig.recruiterRoleId}>\n${body}`,
            allowedMentions: { roles: [guildConfig.recruiterRoleId] }
          })
          .catch(() => undefined);
        await store.markTicketEscalated(ticket.id);
        logger.info("verification_ticket.escalated", {
          guildId: ticket.guildId,
          ticketId: ticket.id,
          threadId: ticket.threadId
        });
      } catch (error) {
        logger.error("verification_ticket.escalate_failed", error, {
          guildId: ticket.guildId,
          ticketId: ticket.id
        });
      }
    }
  };

  const timer = setInterval(() => {
    void tick().catch((error) => {
      logger.error("verification_ticket.escalation_tick_failed", error);
    });
  }, ESCALATION_TICK_MS);

  return () => clearInterval(timer);
}
