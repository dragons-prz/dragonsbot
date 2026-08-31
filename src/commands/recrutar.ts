import newrelic from "newrelic";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  PartialGuildMember,
  MessageCreateOptions,
  MessageEditOptions,
  MessageFlags,
  SlashCommandBuilder
} from "discord.js";
import {
  MemberActionJob,
  MemberEntry,
  Recruitment
} from "../domain/types";
import {
  getGuildId,
  memberHasAnyRole,
  memberHasRole,
  requireGuildMember
} from "../utils/discord";
import { startJobWorker } from "../utils/jobWorker";
import { logger } from "../utils/logger";
import { editSheetMessage } from "./recruitment/sheet";
import { ButtonHandler, SlashCommand } from "./types";

const APPROVE_PREFIX = "recruitment:approve:";
const VERIFY_MEMBER_PREFIX = "member:verify:";
const JOB_STALE_AFTER_MS = 5 * 60 * 1000;

function buildApprovedMessage(
  guildId: string,
  recruitmentId: number,
  recruitId: string,
  recruiterId: string,
  founderId: string,
  memberPoints: number,
  rankName: string,
  kind: "standard" | "credit" = "standard"
) {
  const isCredit = kind === "credit";
  const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${APPROVE_PREFIX}${guildId}:${recruitmentId}`)
      .setLabel(isCredit ? "Credito aprovado" : "Usuario adicionado")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true)
  );

  const embed = new EmbedBuilder()
    .setTitle(isCredit ? "Credito de recrutamento aprovado" : "Recrutamento aprovado")
    .setColor(0x2f9e44)
    .addFields(
      { name: "Usuario recrutado", value: `<@${recruitId}>`, inline: true },
      { name: "ID copiavel", value: `\`${recruitId}\``, inline: true },
      { name: "Recrutador", value: `<@${recruiterId}>`, inline: true },
      { name: isCredit ? "Credito aprovado por" : "Aprovado por", value: `<@${founderId}>`, inline: true },
      { name: "Pontos do membro", value: String(memberPoints), inline: true },
      { name: "Rank atual", value: rankName, inline: true }
    )
    .setTimestamp();

  return { embeds: [embed], components: [disabledRow] };
}

function buildQueuedApprovalMessage(
  guildId: string,
  recruitmentId: number,
  recruitId: string,
  recruiterId: string,
  founderId: string,
  kind: "standard" | "credit" = "standard"
) {
  const isCredit = kind === "credit";
  const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${APPROVE_PREFIX}${guildId}:${recruitmentId}`)
      .setLabel(isCredit ? "Credito enfileirado" : "Aprovacao enfileirada")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  const embed = new EmbedBuilder()
    .setTitle(isCredit ? "Credito de recrutamento enfileirado" : "Aprovacao de recrutamento enfileirada")
    .setColor(0xf08c00)
    .setDescription("A acao foi colocada na fila e sera processada pelo bot em instantes.")
    .addFields(
      { name: "Usuario", value: `<@${recruitId}>`, inline: true },
      { name: "Recrutador", value: `<@${recruiterId}>`, inline: true },
      { name: "Solicitado por", value: `<@${founderId}>`, inline: true },
      { name: "Recrutamento", value: `#${recruitmentId}`, inline: true }
    )
    .setTimestamp();

  return { embeds: [embed], components: [disabledRow] };
}

function formatTimestamp(iso: string) {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:F>`;
}

function buildApprovalMessage(
  guildId: string,
  recruitmentId: number,
  recruitId: string,
  recruiterId: string,
  kind: "standard" | "credit" = "standard",
  verifiedByUserId?: string | null,
  joinedAt?: string
) {
  const isCredit = kind === "credit";
  const embed = new EmbedBuilder()
    .setTitle(isCredit ? "Credito de recrutamento pendente" : "Recrutamento pendente")
    .setColor(0xd63f3f)
    .setDescription(
      isCredit
        ? "O membro ja foi verificado. Confirme se este recrutador deve receber os pontos."
        : "Adicione o usuario na familia do servidor da Pureza. Depois confirme pelo botao abaixo."
    )
    .addFields(
      { name: "Usuario recrutado", value: `<@${recruitId}>`, inline: true },
      { name: "ID copiavel", value: `\`${recruitId}\``, inline: true },
      { name: "Recrutador", value: `<@${recruiterId}>`, inline: true },
      { name: "Recrutamento", value: `#${recruitmentId}`, inline: true }
    )
    .setTimestamp();

  if (isCredit) {
    embed.addFields(
      { name: "Ja verificado por", value: verifiedByUserId ? `<@${verifiedByUserId}>` : "Nao registrado", inline: true },
      { name: "Entrada", value: joinedAt ? formatTimestamp(joinedAt) : "Nao registrada", inline: true }
    );
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${APPROVE_PREFIX}${guildId}:${recruitmentId}`)
      .setLabel(isCredit ? "Aprovar credito" : "Adicionei na familia")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

function buildRecruitmentAnnouncement(recruitId: string, recruiterId: string, recruitmentId: number) {
  const embed = new EmbedBuilder()
    .setTitle("Novo membro recrutado")
    .setColor(0x2f9e44)
    .setDescription(`<@${recruitId}> foi recrutado por <@${recruiterId}>.`)
    .addFields(
      { name: "Membro", value: `<@${recruitId}>`, inline: true },
      { name: "Recrutador", value: `<@${recruiterId}>`, inline: true },
      { name: "Recrutamento", value: `#${recruitmentId}`, inline: true }
    )
    .setTimestamp();

  return { embeds: [embed] };
}

function buildMemberEntryCard(
  member: GuildMember,
  entry: MemberEntry,
  options?: {
    title?: string;
    description?: string;
    color?: number;
    buttonDisabled?: boolean;
    buttonLabel?: string;
    extraFields?: { name: string; value: string; inline?: boolean }[];
  }
): MessageCreateOptions & MessageEditOptions {
  const embed = new EmbedBuilder()
    .setTitle(options?.title ?? "Novo membro aguardando verificacao")
    .setColor(options?.color ?? 0xd63f3f)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Usuario", value: `${member.user.tag}\n<@${member.id}>`, inline: true },
      { name: "ID copiavel", value: `\`${member.id}\``, inline: true },
      { name: "Entrou em", value: formatTimestamp(entry.joinedAt), inline: false },
      ...(options?.extraFields ?? [])
    )
    .setTimestamp();

  if (options?.description) {
    embed.setDescription(options.description);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${VERIFY_MEMBER_PREFIX}${entry.guildId}:${entry.userId}`)
      .setLabel(options?.buttonLabel ?? "Verificar")
      .setStyle(ButtonStyle.Success)
      .setDisabled(options?.buttonDisabled ?? false)
  );

  return { embeds: [embed], components: [row] };
}

function buildMemberEntryQueuedCard(member: GuildMember, entry: MemberEntry, requestedByUserId: string) {
  return buildMemberEntryCard(member, entry, {
    title: "Verificacao enfileirada",
    description: "A verificacao foi colocada na fila e sera processada pelo bot em instantes.",
    color: 0xf08c00,
    buttonDisabled: true,
    buttonLabel: "Na fila",
    extraFields: [
      { name: "Solicitada por", value: `<@${requestedByUserId}>`, inline: true }
    ]
  });
}

async function editMemberEntryCard(
  client: Client,
  entry: MemberEntry | null,
  member: GuildMember,
  options: Parameters<typeof buildMemberEntryCard>[2]
) {
  if (!entry?.verificationChannelId || !entry.verificationMessageId) {
    return;
  }

  const channel = await client.channels.fetch(entry.verificationChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(entry.verificationMessageId).catch(() => null);
  if (!message) {
    return;
  }

  await message.edit(buildMemberEntryCard(member, entry, options));
}

/**
 * Na entrada de um membro so garantimos o registro (`MemberEntry`). O card
 * automatico na fila de verificacao saiu: a porta unica agora e o painel
 * "Verificar-se" -> ticket de verificacao. `/verificar` (Founder) continua
 * como atalho de emergencia.
 */
export async function announceNewMember(member: GuildMember, store: Parameters<SlashCommand["execute"]>[1]["store"]) {
  if (member.user.bot) {
    return;
  }

  const joinedAt = member.joinedAt?.toISOString() ?? new Date().toISOString();
  await store.createOrUpdateMemberEntry({
    guildId: member.guild.id,
    userId: member.id,
    joinedAt
  });
  logger.info("member_entry.registered", {
    guildId: member.guild.id,
    userId: member.id,
    userTag: member.user.tag,
    joinedAt
  });

  await applyUnverifiedRole(member, store);
}

/**
 * Aplica o cargo "Nao verificado" (`GuildConfig.unverifiedRoleId`, editavel
 * pelo painel / `/config set-role unverified`) na entrada de qualquer membro.
 * E removido depois por `applyMemberRoles` quando o membro ganha o cargo
 * `member` (verificacao direta, recrutamento de Area ou de Familia). Falha de
 * cargo vira log e nao derruba o registro da entrada.
 */
async function applyUnverifiedRole(member: GuildMember, store: CommandStore): Promise<void> {
  const guildId = member.guild.id;
  const config = await store.getGuildConfig(guildId);
  const unverifiedRoleId = config.unverifiedRoleId;
  const logContext = { guildId, userId: member.id, userTag: member.user.tag, unverifiedRoleId };

  if (!unverifiedRoleId) {
    return;
  }
  // Rejoin de quem ja passou pela verificacao: nao rebaixa para "Nao verificado".
  if (member.roles.cache.has(unverifiedRoleId) || member.roles.cache.has(config.memberRoleId)) {
    return;
  }

  const botMember = await member.guild.members.fetchMe();
  const role = await member.guild.roles.fetch(unverifiedRoleId).catch(() => null);
  if (!role) {
    logger.warn("member_entry.unverified_role_add_failed", { reason: "role_not_found", ...logContext });
    return;
  }
  if (!role.editable || botMember.roles.highest.comparePositionTo(role) <= 0) {
    logger.warn("member_entry.unverified_role_add_failed", { reason: "role_not_manageable", ...logContext });
    return;
  }

  await member.roles
    .add(role, "Entrada no servidor - aguardando verificacao")
    .then(() => {
      logger.info("member_entry.unverified_role_added", logContext);
    })
    .catch((error) => {
      logger.error("member_entry.unverified_role_add_failed", error, logContext);
    });
}

export async function announceMemberExit(member: GuildMember | PartialGuildMember, store: Parameters<SlashCommand["execute"]>[1]["store"]) {
  if (member.user.bot) {
    return;
  }

  const guildId = member.guild.id;
  const config = await store.getGuildConfig(guildId);
  const entry = await store.getMemberEntry(guildId, member.id);
  const updatedEntry = entry ? await store.markMemberEntryLeft(guildId, member.id) : null;
  const pending = await store.findPendingRecruitmentByUser(guildId, member.id);

  const channel = await member.guild.channels.fetch(config.memberExitChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    logger.warn("member_exit.channel_not_found", {
      guildId,
      userId: member.id,
      userTag: member.user.tag,
      channelId: config.memberExitChannelId
    });
    return;
  }

  const leftAt = updatedEntry?.leftAt ?? new Date().toISOString();
  const roles = member.roles.cache
    .filter((role) => role.id !== guildId)
    .sort((a, b) => b.position - a.position)
    .map((role) => `<@&${role.id}>`)
    .slice(0, 20);

  const embed = new EmbedBuilder()
    .setTitle("Membro saiu do servidor")
    .setColor(0x868e96)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Usuario", value: `${member.user.tag}\n<@${member.id}>`, inline: true },
      { name: "ID copiavel", value: `\`${member.id}\``, inline: true },
      { name: "Saiu em", value: formatTimestamp(leftAt), inline: false },
      { name: "Entrada registrada", value: entry?.joinedAt ? formatTimestamp(entry.joinedAt) : "Nao registrada", inline: true },
      { name: "Status conhecido", value: entry?.status ?? "sem registro", inline: true },
      { name: "Recrutador creditado", value: entry?.recruiterUserId ? `<@${entry.recruiterUserId}>` : "Nenhum", inline: true }
    )
    .setTimestamp();

  if (pending) {
    embed.addFields(
      { name: "Recrutamento pendente", value: `#${pending.id} por <@${pending.recruiterUserId}>`, inline: false }
    );
  }

  embed.addFields({
    name: `Cargos conhecidos (${roles.length})`,
    value: roles.length > 0 ? roles.join(" ") : "Nenhum cargo registrado no evento.",
    inline: false
  });

  await channel.send({ embeds: [embed] });
  logger.info("member_exit.announced", {
    guildId,
    userId: member.id,
    userTag: member.user.tag,
    channelId: config.memberExitChannelId,
    entryStatus: entry?.status,
    leftAt
  });
}

/**
 * Aplica os cargos escolhidos no wizard: o cargo de iniciante e os cargos de
 * cada area. Cada `roles.add` e independente — falha de um cargo vira log e
 * nao derruba o job, porque os pontos e o status ja foram gravados em
 * transacao e nao da para "desaprovar" o recrutamento.
 */
async function applyRecruitmentRoles(
  guild: Guild,
  recruitMember: GuildMember,
  recruitment: Recruitment,
  logContext: Record<string, unknown>
): Promise<void> {
  const targets: { roleId: string; kind: "starter" | "area" }[] = [
    ...(recruitment.starterRoleId ? [{ roleId: recruitment.starterRoleId, kind: "starter" as const }] : []),
    ...recruitment.areaRoleIds.map((roleId) => ({ roleId, kind: "area" as const }))
  ];

  for (const target of targets) {
    const role = await guild.roles.fetch(target.roleId).catch(() => null);
    if (!role) {
      logger.warn(
        target.kind === "starter"
          ? "recruitment.starter_role_add_failed"
          : "recruitment.area_role_add_failed",
        { reason: "role_not_found", guildId: guild.id, roleId: target.roleId, ...logContext }
      );
      continue;
    }

    if (recruitMember.roles.cache.has(role.id)) {
      continue;
    }

    await recruitMember.roles
      .add(role, `Recrutamento #${recruitment.id} aprovado`)
      .catch((error) => {
        logger.error(
          target.kind === "starter"
            ? "recruitment.starter_role_add_failed"
            : "recruitment.area_role_add_failed",
          error,
          { guildId: guild.id, roleId: target.roleId, userId: recruitMember.id, ...logContext }
        );
      });
  }
}

type ApplyMemberRolesResult =
  | { ok: true; rankName: string }
  | { ok: false; message: string };

async function applyMemberRoles(
  guildId: string,
  recruitMember: GuildMember,
  founder: GuildMember,
  memberRoleId: string,
  unverifiedRoleId: string,
  store: Parameters<SlashCommand["execute"]>[1]["store"],
  reason: string,
  logContext: Record<string, unknown>
): Promise<ApplyMemberRolesResult> {
  const guild = recruitMember.guild;
  const botMember = await guild.members.fetchMe();
  const memberRole = await guild.roles.fetch(memberRoleId).catch(() => null);
  if (!memberRole) {
    logger.warn("member_roles.blocked", {
      reason: "member_role_not_found",
      guildId,
      founderUserId: founder.id,
      founderUserTag: founder.user.tag,
      memberRoleId,
      ...logContext
    });
    return { ok: false, message: "O cargo de membro configurado nao foi encontrado." };
  }

  if (!memberRole.editable || botMember.roles.highest.comparePositionTo(memberRole) <= 0) {
    logger.warn("member_roles.blocked", {
      reason: "member_role_not_editable",
      guildId,
      founderUserId: founder.id,
      founderUserTag: founder.user.tag,
      memberRoleId,
      ...logContext
    });
    return { ok: false, message: "Nao consigo gerenciar o cargo de membro configurado. Verifique a hierarquia de cargos." };
  }

  if (!recruitMember.roles.cache.has(memberRole.id)) {
    await recruitMember.roles.add(memberRole, reason);
  }

  const { profile: recruitedProfile, rank: baseRank } = await store.ensureMemberProfile(guildId, recruitMember.id);
  const baseRankRole = await guild.roles.fetch(baseRank.roleId).catch(() => null);
  if (baseRankRole && !recruitMember.roles.cache.has(baseRankRole.id)) {
    await recruitMember.roles.add(baseRankRole, `Rank inicial ${baseRank.name}`).catch((error) => {
      logger.error("hierarchy.base_rank_add_failed", error, {
        guildId,
        userId: recruitMember.id,
        userTag: recruitMember.user.tag,
        rankName: recruitedProfile.rankName,
        rankRoleId: recruitedProfile.rankRoleId,
        ...logContext
      });
    });
  }

  // O membro deixou de ser "Nao verificado" ao ganhar o cargo `member`.
  // Idempotente: so remove se ainda tiver o cargo. Falha vira log e nao
  // reverte a verificacao/recrutamento (cargo `member` e pontos ja gravados).
  if (unverifiedRoleId && recruitMember.roles.cache.has(unverifiedRoleId)) {
    const unverifiedRole = await guild.roles.fetch(unverifiedRoleId).catch(() => null);
    if (
      unverifiedRole &&
      unverifiedRole.editable &&
      botMember.roles.highest.comparePositionTo(unverifiedRole) > 0
    ) {
      await recruitMember.roles
        .remove(unverifiedRole, reason)
        .then(() => {
          logger.info("member_roles.unverified_role_removed", {
            guildId,
            userId: recruitMember.id,
            userTag: recruitMember.user.tag,
            unverifiedRoleId,
            ...logContext
          });
        })
        .catch((error) => {
          logger.error("member_roles.unverified_role_remove_failed", error, {
            guildId,
            userId: recruitMember.id,
            unverifiedRoleId,
            ...logContext
          });
        });
    } else {
      logger.warn("member_roles.unverified_role_remove_failed", {
        reason: "role_not_manageable",
        guildId,
        userId: recruitMember.id,
        unverifiedRoleId,
        ...logContext
      });
    }
  }

  return { ok: true, rankName: baseRank.name };
}

type CommandStore = Parameters<SlashCommand["execute"]>[1]["store"];

async function updateApprovalMessages(client: Client, recruitmentId: number, store: CommandStore, message: MessageEditOptions) {
  const approvalMessages = await store.getRecruitmentApprovalMessages(recruitmentId);
  const updateResults = await Promise.allSettled(
    approvalMessages.map(async (approvalMessage) => {
      const channel = await client.channels.fetch(approvalMessage.channelId);
      if (!channel || !channel.isTextBased()) {
        return;
      }

      const existingMessage = await channel.messages.fetch(approvalMessage.messageId);
      await existingMessage.edit(message);
    })
  );

  return {
    approvalMessages,
    updatedMessages: updateResults.filter((result) => result.status === "fulfilled").length,
    failedMessageUpdates: updateResults.filter((result) => result.status === "rejected").length
  };
}

async function processVerifyMemberJob(client: Client, store: CommandStore, job: MemberActionJob) {
  const guild = await client.guilds.fetch(job.guildId).catch(() => null);
  if (!guild) {
    await store.cancelMemberActionJob(job.id, "Servidor nao encontrado.");
    return;
  }

  const founder = await guild.members.fetch(job.requestedByUserId).catch(() => null);
  if (!founder) {
    await store.cancelMemberActionJob(job.id, "Founder solicitante nao encontrado no servidor.");
    return;
  }

  const config = await store.getGuildConfig(job.guildId);
  if (!memberHasRole(founder, config.founderRoleId)) {
    await store.cancelMemberActionJob(job.id, "Solicitante nao possui mais o cargo Founder.");
    return;
  }

  const recruitMember = await guild.members.fetch(job.userId).catch(() => null);
  if (!recruitMember) {
    await store.cancelMemberActionJob(job.id, "Usuario saiu do servidor ou nao foi encontrado.");
    return;
  }

  const entry = await store.getMemberEntry(job.guildId, job.userId);
  const pending = await store.findPendingRecruitmentByUser(job.guildId, job.userId);
  if (pending || entry?.status === "recruitment_pending" || entry?.status === "credit_pending") {
    await store.cancelMemberActionJob(job.id, "Usuario possui recrutamento ou credito pendente.");
    return;
  }

  if (entry?.status === "recruited" || entry?.status === "credited" || entry?.creditedAt) {
    await store.cancelMemberActionJob(job.id, "Usuario ja possui recrutamento ou credito aprovado.");
    return;
  }

  const applied = await applyMemberRoles(
    job.guildId,
    recruitMember as GuildMember,
    founder,
    config.memberRoleId,
    config.unverifiedRoleId,
    store,
    `Verificacao direta por ${founder.user.tag}`,
    {
      source: job.id,
      recruitUserId: job.userId,
      recruitUserTag: recruitMember.user.tag
    }
  );
  if (!applied.ok) {
    throw new Error(applied.message);
  }

  const updatedEntry = await store.markMemberEntryVerifiedDirect(job.guildId, job.userId, founder.id);
  if (updatedEntry) {
    await editMemberEntryCard(client, updatedEntry, recruitMember as GuildMember, {
      title: "Membro verificado diretamente",
      description: `Verificado por <@${founder.id}>. Credito de recrutamento ainda pode ser solicitado a qualquer momento, se ainda nao houver recrutador creditado.`,
      color: 0x2f9e44,
      buttonDisabled: true,
      buttonLabel: "Verificado",
      extraFields: [
        { name: "Verificado por", value: `<@${founder.id}>`, inline: true },
        { name: "Verificado em", value: formatTimestamp(updatedEntry.verifiedAt ?? new Date().toISOString()), inline: true }
      ]
    });
  }

  logger.info("member_verification.completed", {
    guildId: job.guildId,
    jobId: job.id,
    founderUserId: founder.id,
    founderUserTag: founder.user.tag,
    recruitUserId: job.userId,
    recruitUserTag: recruitMember.user.tag,
    memberRoleId: config.memberRoleId,
    baseRankName: applied.rankName,
    source: "job"
  });

  await store.completeMemberActionJob(job.id);
}

async function processApproveRecruitmentJob(client: Client, store: CommandStore, job: MemberActionJob) {
  if (!job.recruitmentId) {
    await store.cancelMemberActionJob(job.id, "Job de aprovacao sem recruitmentId.");
    return;
  }

  const guild = await client.guilds.fetch(job.guildId).catch(() => null);
  if (!guild) {
    await store.cancelMemberActionJob(job.id, "Servidor do recrutamento nao encontrado.");
    return;
  }

  const founder = await guild.members.fetch(job.requestedByUserId).catch(() => null);
  if (!founder) {
    await store.cancelMemberActionJob(job.id, "Founder solicitante nao encontrado no servidor.");
    return;
  }

  const config = await store.getGuildConfig(job.guildId);
  const flowConfig = await store.getRecruitmentFlowConfig(job.guildId);

  const recruitment = await store.getRecruitment(job.recruitmentId);
  if (!recruitment || recruitment.guildId !== job.guildId) {
    await store.cancelMemberActionJob(job.id, "Recrutamento nao encontrado.");
    return;
  }

  if (recruitment.status !== "pending") {
    await store.cancelMemberActionJob(job.id, "Recrutamento ja foi aprovado.");
    return;
  }

  // Quem confirma a ficha e definido no painel. As rotas novas
  // (`familyRoute`/`areaRoute`) congelam os cargos no envio; recrutamento
  // legado cai no `flowConfig.approverRoleIds` do topo.
  const approverRoleIds =
    recruitment.sheetPresentation && recruitment.sheetPresentation.routeApproverRoleIds.length > 0
      ? recruitment.sheetPresentation.routeApproverRoleIds
      : flowConfig.approverRoleIds;
  if (!memberHasAnyRole(founder, approverRoleIds)) {
    await store.cancelMemberActionJob(job.id, "Solicitante nao possui mais cargo de aprovacao.");
    return;
  }

  const recruitMember = await guild.members.fetch(recruitment.recruitUserId).catch(() => null);
  if (!recruitMember) {
    await store.cancelMemberActionJob(job.id, "Usuario recrutado saiu do servidor ou nao foi encontrado.");
    return;
  }
  const recruiterMember = await guild.members.fetch(recruitment.recruiterUserId).catch(() => null);

  // Idempotente (so adiciona o cargo/rank que falta), entao serve tanto para
  // quem esta entrando pela primeira vez quanto para quem ja e membro e esta
  // sendo recrutado de novo para uma area nova. Sem restricao de janela de
  // tempo nem exigencia de entrada registrada — a aprovacao da gerencia na
  // ficha ja e a trava.
  const applied = await applyMemberRoles(
    job.guildId,
    recruitMember as GuildMember,
    founder,
    config.memberRoleId,
    config.unverifiedRoleId,
    store,
    `Recrutamento aprovado por ${founder.user.tag}`,
    { source: job.id, recruitmentId: recruitment.id }
  );
  if (!applied.ok) {
    throw new Error(applied.message);
  }

  // Pontos congelados no envio da ficha (soma das areas) — inclusive quando
  // dao zero. Recrutamento legado, do fluxo de DM, nao tem snapshot e cai no
  // valor fixo do config.
  const pointsToAward = recruitment.sheetPresentation
    ? recruitment.points
    : config.recruitmentPoints;
  const approval = await store.approveRecruitmentAndAddMemberPoints(
    recruitment.id,
    founder.id,
    pointsToAward,
    recruitment.kind === "credit"
      ? `Credito de recrutamento #${recruitment.id} aprovado`
      : `Recrutamento #${recruitment.id} aprovado`
  );
  if (!approval) {
    await store.cancelMemberActionJob(job.id, "Recrutamento ja foi aprovado.");
    return;
  }
  const { recruitment: approved, member: promotedMember } = approval;

  // Cargos do fluxo novo: cargo de iniciante + cargos das areas escolhidas.
  // Idempotente (so adiciona o que falta), entao serve tambem para o
  // recrutamento de credito, em que o membro ja tem parte deles.
  await applyRecruitmentRoles(guild, recruitMember as GuildMember, approved, {
    jobId: job.id,
    recruitmentId: approved.id
  });

  // Sem up automatico: os pontos do recrutador continuam acumulando
  // (`approveRecruitmentAndAddMemberPoints` acima), mas o cargo de rank NAO
  // e mais aplicado/removido pelo bot — mudanca de cargo segue o sistema da
  // administracao.

  let approvalMessages: { messageId: string }[] = [];
  let updatedMessages = 0;
  let failedMessageUpdates = 0;
  if (approved.sheetPresentation) {
    await editSheetMessage(client, store, approved, "approved", founder.id);
  } else {
    // Recrutamento legado: continua atualizando as DMs enviadas aos founders.
    const approvedMessage = buildApprovedMessage(
      approved.guildId,
      approved.id,
      approved.recruitUserId,
      approved.recruiterUserId,
      founder.id,
      promotedMember.points,
      promotedMember.rankName,
      approved.kind
    );
    const result = await updateApprovalMessages(client, approved.id, store, approvedMessage);
    approvalMessages = result.approvalMessages;
    updatedMessages = result.updatedMessages;
    failedMessageUpdates = result.failedMessageUpdates;
  }

  const updatedEntry = approved.kind === "credit"
    ? await store.markMemberEntryCredited(approved.guildId, approved.recruitUserId, approved.recruiterUserId, founder.id, approved.id)
    : await store.markMemberEntryRecruited(approved.guildId, approved.recruitUserId, approved.recruiterUserId, founder.id, approved.id);
  if (updatedEntry) {
    await editMemberEntryCard(client, updatedEntry, recruitMember as GuildMember, {
      title: approved.kind === "credit" ? "Credito de recrutamento aprovado" : "Recrutamento aprovado",
      description: approved.kind === "credit"
        ? `Credito aprovado para <@${approved.recruiterUserId}> por <@${founder.id}>.`
        : `Recrutamento #${approved.id} aprovado por <@${founder.id}>.`,
      color: 0x2f9e44,
      buttonDisabled: true,
      buttonLabel: approved.kind === "credit" ? "Credito aprovado" : "Aprovado",
      extraFields: [
        { name: "Recrutador", value: `<@${approved.recruiterUserId}>`, inline: true },
        { name: approved.kind === "credit" ? "Credito" : "Recrutamento", value: `#${approved.id}`, inline: true },
        { name: "Aprovado por", value: `<@${founder.id}>`, inline: true }
      ]
    });
  }

  logger.info("recruitment.approved", {
    guildId: job.guildId,
    jobId: job.id,
    recruitmentId: approved.id,
    kind: approved.kind,
    founderUserId: founder.id,
    founderUserTag: founder.user.tag,
    recruiterUserId: approved.recruiterUserId,
    recruiterUserTag: recruiterMember?.user.tag,
    recruitUserId: approved.recruitUserId,
    recruitUserTag: recruitMember.user.tag,
    pointsAdded: pointsToAward,
    memberTotalPoints: promotedMember.points,
    memberRecruitments: promotedMember.recruitments,
    memberRankName: promotedMember.rankName,
    rankChanged: approval.rankChanged,
    approvalMessages: approvalMessages.length,
    updatedMessages,
    failedMessageUpdates
  });

  const announcementChannel = approved.kind === "standard"
    ? await guild.channels.fetch(config.recruitmentAnnouncementChannelId).catch(() => null)
    : null;
  if (approved.kind === "standard" && announcementChannel?.isTextBased() && "send" in announcementChannel) {
    await announcementChannel.send(
      buildRecruitmentAnnouncement(approved.recruitUserId, approved.recruiterUserId, approved.id)
    ).then(() => {
      logger.info("recruitment.announcement_sent", {
        guildId: job.guildId,
        recruitmentId: approved.id,
        channelId: config.recruitmentAnnouncementChannelId,
        recruitUserId: approved.recruitUserId,
        recruiterUserId: approved.recruiterUserId
      });
    }).catch((error) => {
      logger.error("recruitment.announcement_failed", error, {
        guildId: job.guildId,
        recruitmentId: approved.id,
        channelId: config.recruitmentAnnouncementChannelId
      });
    });
  } else if (approved.kind === "standard") {
    logger.warn("recruitment.announcement_channel_not_found", {
      guildId: job.guildId,
      recruitmentId: approved.id,
      channelId: config.recruitmentAnnouncementChannelId
    });
  }

  if (approved.ticketId) {
    await finalizeVerificationTicket(client, store, approved, founder, flowConfig).catch((error) => {
      logger.error("verification_ticket.finalize_failed", error, {
        guildId: job.guildId,
        recruitmentId: approved.id,
        ticketId: approved.ticketId
      });
    });
  }

  await store.completeMemberActionJob(job.id);
}

/**
 * Encerra o ticket de verificacao quando a ficha e confirmada.
 *
 * A mensagem publica do wizard ja e apagada no envio (o desfecho vai
 * ephemeral so para o recrutador), entao aqui so resta cuidar da thread:
 *
 * - Rota Familia: posta a mensagem de encerramento, tranca + arquiva a
 *   thread e fecha o ticket (o processo nao pode ser refeito — ver tambem
 *   o guard `blockedAlreadyInFamilyMessage` no `/recrutar`).
 * - Rota Area: so arquiva a thread e fecha o ticket — a lideranca de REC
 *   "da continuidade" no processo dela, sem aviso do bot.
 */
async function finalizeVerificationTicket(
  client: Client,
  store: CommandStore,
  recruitment: Recruitment,
  approver: GuildMember,
  flowConfig: Awaited<ReturnType<CommandStore["getRecruitmentFlowConfig"]>>
): Promise<void> {
  if (!recruitment.ticketId) {
    return;
  }
  const ticket = await store.getTicket(recruitment.ticketId);
  if (!ticket || ticket.status === "closed") {
    return;
  }
  const isFamily = recruitment.sheetPresentation?.routeKind === "family";
  const thread = ticket.threadId
    ? await client.channels.fetch(ticket.threadId).catch(() => null)
    : null;

  if (thread?.isThread()) {
    if (isFamily) {
      const body = flowConfig.verificationTicket.closeMessage
        .replace(/\{user\}/g, `<@${ticket.openerUserId}>`)
        .replace(/\{closer\}/g, `<@${approver.id}>`);
      await thread.send(body).catch(() => undefined);
      await thread.setLocked(true).catch(() => undefined);
    }
    await thread.setArchived(true).catch(() => undefined);
  }

  await store.releaseTicketSlot(ticket.guildId, ticket.openerUserId).catch(() => undefined);
  await store.closeTicket(ticket.id, approver.id).catch(() => undefined);

  logger.info(
    isFamily ? "verification_ticket.recruited_family" : "verification_ticket.recruited_area",
    {
      guildId: ticket.guildId,
      ticketId: ticket.id,
      threadId: ticket.threadId,
      recruitmentId: recruitment.id,
      approverUserId: approver.id
    }
  );
}

async function processMemberActionJob(client: Client, store: CommandStore, job: MemberActionJob) {
  logger.info("member_action_job.processing", {
    jobId: job.id,
    type: job.type,
    guildId: job.guildId,
    userId: job.userId,
    recruitmentId: job.recruitmentId,
    requestedByUserId: job.requestedByUserId,
    attempts: job.attempts
  });

  if (job.type === "verify_member") {
    await processVerifyMemberJob(client, store, job);
    return;
  }

  await processApproveRecruitmentJob(client, store, job);
}

async function restoreMemberActionJobUiOnFailure(client: Client, store: CommandStore, job: MemberActionJob, errorMessage: string) {
  if (job.type === "verify_member") {
    const guild = await client.guilds.fetch(job.guildId).catch(() => null);
    const member = await guild?.members.fetch(job.userId).catch(() => null);
    const entry = await store.getMemberEntry(job.guildId, job.userId);
    if (member && entry) {
      await editMemberEntryCard(client, entry, member as GuildMember, {
        title: "Falha ao verificar membro",
        description: `A verificacao falhou e pode ser tentada novamente. Erro: ${errorMessage}`,
        color: 0xd63f3f,
        buttonDisabled: false,
        buttonLabel: "Tentar verificar"
      });
    }
    return;
  }

  if (!job.recruitmentId) {
    return;
  }

  const recruitment = await store.getRecruitment(job.recruitmentId);
  if (!recruitment || recruitment.status !== "pending") {
    return;
  }

  if (recruitment.sheetPresentation) {
    // Fluxo novo: a ficha volta ao estado clicavel para tentarem de novo.
    await editSheetMessage(client, store, recruitment, "pending", null);
    return;
  }

  const entry = await store.getMemberEntry(recruitment.guildId, recruitment.recruitUserId);
  await updateApprovalMessages(
    client,
    recruitment.id,
    store,
    buildApprovalMessage(
      recruitment.guildId,
      recruitment.id,
      recruitment.recruitUserId,
      recruitment.recruiterUserId,
      recruitment.kind,
      entry?.verifiedByUserId,
      entry?.joinedAt
    )
  );
}

export function startMemberActionJobWorker(client: Client, store: CommandStore) {
  const drainOne = async (): Promise<boolean> => {
    const job = await store.claimNextPendingMemberActionJob();
    if (!job) {
      return false;
    }

    // Uma background transaction por job, nomeada pelo tipo
    // (OtherTransaction/member_action_job/verify_member | approve_recruitment).
    await newrelic.startBackgroundTransaction(job.type, "member_action_job", async () => {
      try {
        await processMemberActionJob(client, store, job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("member_action_job.failed", error, {
          jobId: job.id,
          type: job.type,
          guildId: job.guildId,
          userId: job.userId,
          recruitmentId: job.recruitmentId
        });
        await store.failMemberActionJob(job.id, message);
        await restoreMemberActionJobUiOnFailure(client, store, job, message).catch((restoreError) => {
          logger.error("member_action_job.restore_ui_failed", restoreError, {
            jobId: job.id,
            type: job.type
          });
        });
      }
    });

    return true;
  };

  return startJobWorker({
    name: "member_action_job",
    resetStale: () => store.resetStaleProcessingMemberActionJobs(JOB_STALE_AFTER_MS),
    drainOne,
    watch: (onPending) => store.watchPendingMemberActionJobs(onPending)
  });
}

export const verificarCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("verificar")
    .setDescription("Verifica um novo membro diretamente, sem DM ou pontos de recrutamento.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Membro a verificar.").setRequired(true)
    ),

  async execute(interaction, { store }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = getGuildId(interaction);
    const founder = requireGuildMember(interaction);
    const config = await store.getGuildConfig(guildId);

    if (!memberHasRole(founder, config.founderRoleId)) {
      logger.warn("member_verification.blocked", {
        reason: "missing_founder_role",
        guildId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        requiredRoleId: config.founderRoleId
      });
      await interaction.editReply("Apenas Founders podem verificar membros.");
      return;
    }

    const recruitUser = interaction.options.getUser("usuario", true);
    logger.info("member_verification.requested", {
      guildId,
      founderUserId: founder.id,
      founderUserTag: founder.user.tag,
      recruitUserId: recruitUser.id,
      recruitUserTag: recruitUser.tag
    });

    const recruitMember = await interaction.guild!.members.fetch(recruitUser.id).catch(() => null);
    if (!recruitMember) {
      logger.warn("member_verification.blocked", {
        reason: "recruit_not_in_guild",
        guildId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag
      });
      await interaction.editReply("O usuario informado nao esta no servidor.");
      return;
    }

    const blacklistEntry = await store.getBlacklistEntry(guildId, recruitUser.id);
    if (blacklistEntry) {
      logger.warn("member_verification.blocked", {
        reason: "blacklisted",
        guildId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag,
        blacklistReason: blacklistEntry.reason
      });
      await interaction.editReply(`⚠️ Este usuario esta na blacklist e nao pode ser verificado. Motivo: ${blacklistEntry.reason}`);
      return;
    }

    if (recruitMember.roles.cache.has(config.memberRoleId)) {
      logger.warn("member_verification.blocked", {
        reason: "recruit_already_member",
        guildId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag,
        memberRoleId: config.memberRoleId
      });
      await interaction.editReply("Este usuario ja possui o cargo de membro.");
      return;
    }

    const pending = await store.findPendingRecruitmentByUser(guildId, recruitUser.id);
    if (pending) {
      logger.warn("member_verification.blocked", {
        reason: "pending_recruitment_exists",
        guildId,
        recruitmentId: pending.id,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag
      });
      await interaction.editReply(`Ja existe um recrutamento pendente para este usuario (#${pending.id}).`);
      return;
    }

    const job = await store.enqueueMemberActionJob({
      type: "verify_member",
      guildId,
      userId: recruitUser.id,
      requestedByUserId: founder.id
    });
    const entry = await store.getMemberEntry(guildId, recruitUser.id);
    if (entry) {
      await editMemberEntryCard(interaction.client, entry, recruitMember as GuildMember, {
        title: job.created ? "Verificacao enfileirada" : "Verificacao ja esta na fila",
        description: "A verificacao sera processada pelo bot em instantes.",
        color: 0xf08c00,
        buttonDisabled: true,
        buttonLabel: "Na fila",
        extraFields: [
          { name: "Solicitada por", value: `<@${founder.id}>`, inline: true }
        ]
      });
    }

    logger.info("member_verification.enqueued", {
      guildId,
      jobId: job.job.id,
      created: job.created,
      founderUserId: founder.id,
      founderUserTag: founder.user.tag,
      recruitUserId: recruitUser.id,
      recruitUserTag: recruitUser.tag
    });

    await interaction.editReply(
      job.created
        ? `Verificacao de <@${recruitUser.id}> enfileirada.`
        : `A verificacao de <@${recruitUser.id}> ja esta na fila ou ja foi processada.`
    );
  }
};

export const verifyMemberButton: ButtonHandler = {
  customIdPrefix: VERIFY_MEMBER_PREFIX,

  async execute(interaction, { store }) {
    const [guildId, userId] = interaction.customId.slice(VERIFY_MEMBER_PREFIX.length).split(":");
    if (!guildId || !userId) {
      logger.warn("member_verification.button_invalid", {
        customId: interaction.customId,
        userId: interaction.user.id,
        userTag: interaction.user.tag
      });
      await interaction.reply({ content: "Verificacao invalida.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      await interaction.editReply("Servidor da verificacao nao encontrado.");
      return;
    }

    const founder = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!founder) {
      await interaction.editReply("Nao consegui validar seu usuario no servidor.");
      return;
    }

    const config = await store.getGuildConfig(guildId);
    if (!memberHasRole(founder, config.founderRoleId)) {
      logger.warn("member_verification.blocked", {
        reason: "missing_founder_role",
        guildId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        requiredRoleId: config.founderRoleId
      });
      await interaction.editReply("Apenas Founders podem verificar membros.");
      return;
    }

    const recruitMember = await guild.members.fetch(userId).catch(() => null);
    if (!recruitMember) {
      await interaction.editReply("O usuario saiu do servidor ou nao foi encontrado.");
      return;
    }

    const blacklistEntry = await store.getBlacklistEntry(guildId, userId);
    if (blacklistEntry) {
      logger.warn("member_verification.blocked", {
        reason: "blacklisted",
        guildId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        recruitUserId: userId,
        blacklistReason: blacklistEntry.reason
      });
      await interaction.editReply(`⚠️ Este usuario esta na blacklist e nao pode ser verificado. Motivo: ${blacklistEntry.reason}`);
      return;
    }

    const entry = await store.getMemberEntry(guildId, userId);
    if (!entry) {
      await interaction.editReply("Entrada do membro nao encontrada.");
      return;
    }

    const pending = await store.findPendingRecruitmentByUser(guildId, userId);
    if (pending || entry.status === "recruitment_pending" || entry.status === "credit_pending") {
      logger.warn("member_verification.blocked", {
        reason: "pending_recruitment_exists",
        guildId,
        recruitmentId: pending?.id ?? entry.recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        recruitUserId: userId,
        entryStatus: entry.status
      });
      await interaction.editReply("Este membro possui recrutamento ou credito pendente. Use a aprovacao desse fluxo.");
      return;
    }

    if (entry.status === "recruited" || entry.status === "credited" || entry.creditedAt) {
      await interaction.editReply("Este membro ja possui recrutamento ou credito aprovado.");
      return;
    }

    if (recruitMember.roles.cache.has(config.memberRoleId)) {
      const updatedEntry = await store.markMemberEntryVerifiedDirect(guildId, userId, founder.id);
      if (updatedEntry) {
        await interaction.message.edit(buildMemberEntryCard(recruitMember as GuildMember, updatedEntry, {
          title: "Membro ja verificado",
          description: `Confirmado por <@${founder.id}>.`,
          color: 0x2f9e44,
          buttonDisabled: true,
          buttonLabel: "Verificado",
          extraFields: [
            { name: "Verificado por", value: `<@${founder.id}>`, inline: true }
          ]
        }));
      }
      await interaction.editReply("Este usuario ja possui o cargo de membro. Atualizei o card.");
      return;
    }

    const job = await store.enqueueMemberActionJob({
      type: "verify_member",
      guildId,
      userId,
      requestedByUserId: founder.id
    });
    await interaction.message.edit(buildMemberEntryQueuedCard(recruitMember as GuildMember, entry, founder.id));

    logger.info("member_verification.enqueued", {
      guildId,
      jobId: job.job.id,
      created: job.created,
      founderUserId: founder.id,
      founderUserTag: founder.user.tag,
      recruitUserId: userId,
      recruitUserTag: recruitMember.user.tag
    });

    await interaction.editReply(
      job.created
        ? `Verificacao de <@${userId}> enfileirada.`
        : `A verificacao de <@${userId}> ja esta na fila ou ja foi processada.`
    );
  }
};

export const approveRecruitmentButton: ButtonHandler = {
  customIdPrefix: APPROVE_PREFIX,

  async execute(interaction, { store }) {
    const [guildId, recruitmentIdRaw] = interaction.customId.slice(APPROVE_PREFIX.length).split(":");
    const recruitmentId = Number(recruitmentIdRaw);
    if (!guildId || !Number.isInteger(recruitmentId)) {
      logger.warn("recruitment.approval_button_invalid", {
        customId: interaction.customId,
        userId: interaction.user.id,
        userTag: interaction.user.tag
      });
      await interaction.reply({ content: "Recrutamento invalido." });
      return;
    }

    await interaction.deferReply();

    const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      logger.warn("recruitment.approval_blocked", {
        reason: "guild_not_found",
        guildId,
        recruitmentId,
        founderUserId: interaction.user.id,
        founderUserTag: interaction.user.tag
      });
      await interaction.editReply("Servidor do recrutamento nao encontrado.");
      return;
    }

    const founder = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!founder) {
      logger.warn("recruitment.approval_blocked", {
        reason: "founder_not_in_guild",
        guildId,
        recruitmentId,
        founderUserId: interaction.user.id,
        founderUserTag: interaction.user.tag
      });
      await interaction.editReply("Nao consegui validar seu usuario no servidor.");
      return;
    }

    const config = await store.getGuildConfig(guildId);

    if (!memberHasRole(founder, config.founderRoleId)) {
      logger.warn("recruitment.approval_blocked", {
        reason: "missing_founder_role",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        requiredRoleId: config.founderRoleId
      });
      await interaction.editReply("Apenas Founders podem confirmar recrutamentos.");
      return;
    }

    const recruitment = await store.getRecruitment(recruitmentId);
    if (!recruitment || recruitment.guildId !== guildId) {
      logger.warn("recruitment.approval_blocked", {
        reason: "recruitment_not_found",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag
      });
      await interaction.editReply("Recrutamento nao encontrado.");
      return;
    }

    if (recruitment.status !== "pending") {
      logger.warn("recruitment.approval_blocked", {
        reason: "already_approved",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        status: recruitment.status
      });
      await interaction.editReply("Este recrutamento ja foi aprovado.");
      return;
    }

    const recruitMember = await guild.members.fetch(recruitment.recruitUserId).catch(() => null);
    if (!recruitMember) {
      logger.warn("recruitment.approval_blocked", {
        reason: "recruit_not_in_guild",
        guildId,
        recruitmentId,
        founderUserId: founder.id,
        founderUserTag: founder.user.tag,
        recruitUserId: recruitment.recruitUserId
      });
      await interaction.editReply("O usuario recrutado saiu do servidor ou nao foi encontrado.");
      return;
    }
    const entry = await store.getMemberEntry(guildId, recruitment.recruitUserId);
    if (recruitment.kind === "credit") {
      if (!entry) {
        await interaction.editReply("Entrada do membro nao encontrada para aprovar credito.");
        return;
      }

      if (entry.creditedAt && entry.recruitmentId !== recruitment.id) {
        await interaction.editReply("Este membro ja possui credito de recrutamento aprovado.");
        return;
      }

      if (!recruitMember.roles.cache.has(config.memberRoleId)) {
        await interaction.editReply("Credito posterior so pode ser aprovado para membro ja verificado.");
        return;
      }
    }

    const job = await store.enqueueMemberActionJob({
      type: "approve_recruitment",
      guildId,
      userId: recruitment.recruitUserId,
      requestedByUserId: founder.id,
      recruitmentId: recruitment.id
    });
    await updateApprovalMessages(
      interaction.client,
      recruitment.id,
      store,
      buildQueuedApprovalMessage(
        recruitment.guildId,
        recruitment.id,
        recruitment.recruitUserId,
        recruitment.recruiterUserId,
        founder.id,
        recruitment.kind
      )
    );

    logger.info("recruitment.approval_enqueued", {
      guildId,
      jobId: job.job.id,
      created: job.created,
      recruitmentId: recruitment.id,
      kind: recruitment.kind,
      founderUserId: founder.id,
      founderUserTag: founder.user.tag,
      recruiterUserId: recruitment.recruiterUserId,
      recruitUserId: recruitment.recruitUserId,
      recruitUserTag: recruitMember.user.tag
    });

    await interaction.editReply(
      job.created
        ? (recruitment.kind === "credit" ? "Credito enfileirado para aprovacao." : "Aprovacao enfileirada.")
        : "Esta aprovacao ja esta na fila ou ja foi processada."
    );
  }
};
