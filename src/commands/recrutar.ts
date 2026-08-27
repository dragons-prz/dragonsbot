import newrelic from "newrelic";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GuildMember,
  PartialGuildMember,
  MessageCreateOptions,
  MessageEditOptions,
  MessageFlags,
  SlashCommandBuilder
} from "discord.js";
import {
  MemberActionJob,
  MemberEntry
} from "../domain/types";
import {
  getGuildId,
  memberHasRole,
  requireGuildMember
} from "../utils/discord";
import { startJobWorker } from "../utils/jobWorker";
import { logger } from "../utils/logger";
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

export async function announceNewMember(member: GuildMember, store: Parameters<SlashCommand["execute"]>[1]["store"]) {
  if (member.user.bot) {
    return;
  }

  const joinedAt = member.joinedAt?.toISOString() ?? new Date().toISOString();
  const entry = await store.createOrUpdateMemberEntry({
    guildId: member.guild.id,
    userId: member.id,
    joinedAt
  });

  const config = await store.getGuildConfig(member.guild.id);
  const channel = await member.guild.channels.fetch(config.memberVerificationChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) {
    logger.warn("member_entry.announcement_channel_not_found", {
      guildId: member.guild.id,
      userId: member.id,
      userTag: member.user.tag,
      channelId: config.memberVerificationChannelId
    });
    return;
  }

  const message = await channel.send({
    content: `<@&${config.founderRoleId}> novo membro aguardando verificacao.`,
    allowedMentions: { roles: [config.founderRoleId] },
    ...buildMemberEntryCard(member, entry)
  });
  await store.setMemberEntryVerificationMessage(member.guild.id, member.id, message.channelId, message.id);
  logger.info("member_entry.announced", {
    guildId: member.guild.id,
    userId: member.id,
    userTag: member.user.tag,
    channelId: message.channelId,
    messageId: message.id,
    joinedAt
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

function isCreditWindowOpen(entry: MemberEntry, windowHours: number) {
  return Date.now() - new Date(entry.joinedAt).getTime() <= windowHours * 60 * 60 * 1000;
}

type ApplyMemberRolesResult =
  | { ok: true; rankName: string }
  | { ok: false; message: string };

async function applyMemberRoles(
  guildId: string,
  recruitMember: GuildMember,
  founder: GuildMember,
  memberRoleId: string,
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
      description: `Verificado por <@${founder.id}>. Credito de recrutamento ainda pode ser solicitado por ate ${config.recruitmentCreditWindowHours}h apos a entrada, se ainda nao houver recrutador creditado.`,
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
  if (!memberHasRole(founder, config.founderRoleId)) {
    await store.cancelMemberActionJob(job.id, "Solicitante nao possui mais o cargo Founder.");
    return;
  }

  const recruitment = await store.getRecruitment(job.recruitmentId);
  if (!recruitment || recruitment.guildId !== job.guildId) {
    await store.cancelMemberActionJob(job.id, "Recrutamento nao encontrado.");
    return;
  }

  if (recruitment.status !== "pending") {
    await store.cancelMemberActionJob(job.id, "Recrutamento ja foi aprovado.");
    return;
  }

  const recruitMember = await guild.members.fetch(recruitment.recruitUserId).catch(() => null);
  if (!recruitMember) {
    await store.cancelMemberActionJob(job.id, "Usuario recrutado saiu do servidor ou nao foi encontrado.");
    return;
  }
  const recruiterMember = await guild.members.fetch(recruitment.recruiterUserId).catch(() => null);

  const entry = await store.getMemberEntry(job.guildId, recruitment.recruitUserId);
  if (recruitment.kind === "credit") {
    if (!entry) {
      await store.cancelMemberActionJob(job.id, "Entrada do membro nao encontrada para aprovar credito.");
      return;
    }

    if (entry.creditedAt && entry.recruitmentId !== recruitment.id) {
      await store.cancelMemberActionJob(job.id, "Membro ja possui credito de recrutamento aprovado.");
      return;
    }

    if (!recruitMember.roles.cache.has(config.memberRoleId)) {
      await store.cancelMemberActionJob(job.id, "Credito posterior so pode ser aprovado para membro ja verificado.");
      return;
    }
  } else {
    const applied = await applyMemberRoles(
      job.guildId,
      recruitMember as GuildMember,
      founder,
      config.memberRoleId,
      store,
      `Recrutamento aprovado por ${founder.user.tag}`,
      { source: job.id, recruitmentId: recruitment.id }
    );
    if (!applied.ok) {
      throw new Error(applied.message);
    }
  }

  const approval = await store.approveRecruitmentAndAddMemberPoints(
    recruitment.id,
    founder.id,
    config.recruitmentPoints,
    recruitment.kind === "credit"
      ? `Credito de recrutamento #${recruitment.id} aprovado`
      : `Recrutamento #${recruitment.id} aprovado`
  );
  if (!approval) {
    await store.cancelMemberActionJob(job.id, "Recrutamento ja foi aprovado.");
    return;
  }
  const { recruitment: approved, member: promotedMember } = approval;

  const currentRankRole = await guild.roles.fetch(promotedMember.rankRoleId).catch(() => null);
  if (!recruiterMember) {
    logger.warn("hierarchy.member_not_found", {
      guildId: job.guildId,
      recruitmentId: approved.id,
      userId: promotedMember.userId,
      rankName: promotedMember.rankName,
      rankRoleId: promotedMember.rankRoleId
    });
  } else {
    if (approval.rankChanged) {
      const oldRank = await guild.roles.fetch(approval.previousRankRoleId).catch(() => null);
      if (oldRank && recruiterMember.roles.cache.has(oldRank.id)) {
        await recruiterMember.roles.remove(oldRank, `Promocao automatica para ${promotedMember.rankName}`).catch((error) => {
          logger.error("hierarchy.old_rank_remove_failed", error, {
            guildId: job.guildId,
            recruitmentId: approved.id,
            userId: recruiterMember.id,
            userTag: recruiterMember.user.tag,
            oldRankRoleId: oldRank.id
          });
        });
      }
    }

    if (currentRankRole && !recruiterMember.roles.cache.has(currentRankRole.id)) {
      await recruiterMember.roles.add(currentRankRole, `Sincronizacao automatica de rank ${promotedMember.rankName}`).catch((error) => {
        logger.error("hierarchy.rank_role_add_failed", error, {
          guildId: job.guildId,
          recruitmentId: approved.id,
          userId: recruiterMember.id,
          userTag: recruiterMember.user.tag,
          rankName: promotedMember.rankName,
          rankRoleId: promotedMember.rankRoleId
        });
      });
    }

    if (approval.rankChanged) {
      await recruiterMember.send(`Parabens! Voce upou para o cargo **${promotedMember.rankName}**.`).catch((error) => {
        logger.error("hierarchy.rank_up_dm_failed", error, {
          guildId: job.guildId,
          recruitmentId: approved.id,
          userId: recruiterMember.id,
          userTag: recruiterMember.user.tag,
          rankName: promotedMember.rankName,
          rankRoleId: promotedMember.rankRoleId
        });
      });
      logger.info("hierarchy.rank_up", {
        guildId: job.guildId,
        recruitmentId: approved.id,
        userId: recruiterMember.id,
        userTag: recruiterMember.user.tag,
        previousRankName: approval.previousRankName,
        previousRankRoleId: approval.previousRankRoleId,
        rankName: promotedMember.rankName,
        rankRoleId: promotedMember.rankRoleId,
        points: promotedMember.points
      });
    }

    if (!currentRankRole) {
      logger.warn("hierarchy.rank_role_not_found", {
        guildId: job.guildId,
        recruitmentId: approved.id,
        userId: promotedMember.userId,
        rankName: promotedMember.rankName,
        rankRoleId: promotedMember.rankRoleId
      });
    }
  }

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
  const { approvalMessages, updatedMessages, failedMessageUpdates } = await updateApprovalMessages(
    client,
    approved.id,
    store,
    approvedMessage
  );

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
    pointsAdded: config.recruitmentPoints,
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

  await store.completeMemberActionJob(job.id);
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

export const recrutarCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("recrutar")
    .setDescription("Envia uma ficha de recrutamento para aprovacao.")
    .addUserOption((option) =>
      option.setName("usuario").setDescription("Membro recrutado.").setRequired(true)
    ),

  async execute(interaction, { store }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = getGuildId(interaction);
    const recruiter = requireGuildMember(interaction);
    const config = await store.getGuildConfig(guildId);

    if (!memberHasRole(recruiter, config.recruiterRoleId)) {
      logger.warn("recruitment.blocked", {
        reason: "missing_recruiter_role",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        requiredRoleId: config.recruiterRoleId
      });
      await interaction.editReply("Voce nao possui o cargo de recrutamento.");
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
      logger.warn("recruitment.blocked", {
        reason: "recruit_not_in_guild",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag
      });
      await interaction.editReply("O usuario informado nao esta no servidor.");
      return;
    }

    const blacklistEntry = await store.getBlacklistEntry(guildId, recruitUser.id);
    if (blacklistEntry) {
      logger.warn("recruitment.blocked", {
        reason: "blacklisted",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag,
        blacklistReason: blacklistEntry.reason
      });
      await interaction.editReply(`⚠️ Este usuario esta na blacklist e nao pode ser recrutado. Motivo: ${blacklistEntry.reason}`);
      return;
    }

    const pending = await store.findPendingRecruitmentByUser(guildId, recruitUser.id);
    if (pending) {
      if (!pending.approvalMessageId) {
        logger.warn("recruitment.pending_orphan_deleted", {
          guildId,
          recruitmentId: pending.id,
          recruitUserId: recruitUser.id
        });
        await store.deletePendingRecruitment(pending.id);
      } else {
        logger.warn("recruitment.blocked", {
          reason: "pending_exists",
          guildId,
          recruitmentId: pending.id,
          recruiterUserId: recruiter.id,
          recruiterUserTag: recruiter.user.tag,
          recruitUserId: recruitUser.id,
          recruitUserTag: recruitUser.tag
        });
        await interaction.editReply(`Ja existe um recrutamento pendente para este usuario (#${pending.id}).`);
        return;
      }
    }

    const memberEntry = await store.getMemberEntry(guildId, recruitUser.id);
    const recruitAlreadyMember = recruitMember.roles.cache.has(config.memberRoleId);
    const recruitmentKind = recruitAlreadyMember ? "credit" : "standard";

    if (recruitAlreadyMember) {
      if (!memberEntry) {
        logger.warn("recruitment.blocked", {
          reason: "member_entry_not_found_for_credit",
          guildId,
          recruiterUserId: recruiter.id,
          recruiterUserTag: recruiter.user.tag,
          recruitUserId: recruitUser.id,
          recruitUserTag: recruitUser.tag
        });
        await interaction.editReply("Este usuario ja e membro e nao possui entrada recente registrada pelo bot para credito.");
        return;
      }

      if (!isCreditWindowOpen(memberEntry, config.recruitmentCreditWindowHours)) {
        logger.warn("recruitment.blocked", {
          reason: "credit_window_expired",
          guildId,
          recruiterUserId: recruiter.id,
          recruiterUserTag: recruiter.user.tag,
          recruitUserId: recruitUser.id,
          recruitUserTag: recruitUser.tag,
          joinedAt: memberEntry.joinedAt
        });
        await interaction.editReply(`Este usuario ja foi verificado e a janela de ${config.recruitmentCreditWindowHours}h para credito expirou.`);
        return;
      }

      if (memberEntry.recruiterUserId || memberEntry.creditedAt || memberEntry.status === "recruitment_pending" || memberEntry.status === "credit_pending") {
        logger.warn("recruitment.blocked", {
          reason: "credit_already_claimed_or_pending",
          guildId,
          recruiterUserId: recruiter.id,
          recruiterUserTag: recruiter.user.tag,
          recruitUserId: recruitUser.id,
          recruitUserTag: recruitUser.tag,
          entryStatus: memberEntry.status,
          entryRecruiterUserId: memberEntry.recruiterUserId
        });
        await interaction.editReply("Este usuario ja possui recrutador creditado ou pedido de credito pendente.");
        return;
      }
    }

    const founders = (await interaction.guild!.members.fetch()).filter(
      (member) => !member.user.bot && member.roles.cache.has(config.founderRoleId)
    );
    if (founders.size === 0) {
      logger.warn("recruitment.blocked", {
        reason: "no_founders_found",
        guildId,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag,
        founderRoleId: config.founderRoleId
      });
      await interaction.editReply("Nao encontrei nenhum Founder para receber a aprovacao por DM.");
      return;
    }

    const recruitment = await store.createRecruitment({
      guildId,
      recruitUserId: recruitUser.id,
      recruiterUserId: recruiter.id,
      kind: recruitmentKind
    });
    logger.info("recruitment.created", {
      guildId,
      recruitmentId: recruitment.id,
      recruiterUserId: recruiter.id,
      recruiterUserTag: recruiter.user.tag,
      recruitUserId: recruitUser.id,
      recruitUserTag: recruitUser.tag,
      kind: recruitment.kind,
      founderCount: founders.size
    });

    try {
      const approvalMessage = buildApprovalMessage(
        guildId,
        recruitment.id,
        recruitUser.id,
        recruiter.id,
        recruitment.kind,
        memberEntry?.verifiedByUserId,
        memberEntry?.joinedAt
      );
      const sentMessages = await Promise.allSettled(
        founders.map(async (founderMember) => ({
          founderId: founderMember.id,
          message: await founderMember.send(approvalMessage)
        }))
      );
      const firstSent = sentMessages.find((result) => result.status === "fulfilled");
      const failedCount = sentMessages.filter((result) => result.status === "rejected").length;
      const sentCount = sentMessages.length - failedCount;

      if (!firstSent || firstSent.status !== "fulfilled") {
        throw new Error("Nenhum Founder recebeu a DM de aprovacao.");
      }

      await store.setRecruitmentApprovalMessage(recruitment.id, firstSent.value.message.id);
      for (const result of sentMessages) {
        if (result.status === "fulfilled") {
          await store.addRecruitmentApprovalMessage({
            recruitmentId: recruitment.id,
            founderUserId: result.value.founderId,
            channelId: result.value.message.channelId,
            messageId: result.value.message.id
          });
        }
      }

      const updatedEntry = recruitment.kind === "credit"
        ? await store.markMemberEntryCreditPending(guildId, recruitUser.id, recruiter.id, recruitment.id)
        : await store.markMemberEntryRecruitmentPending(guildId, recruitUser.id, recruiter.id, recruitment.id);
      if (updatedEntry) {
        await editMemberEntryCard(interaction.client, updatedEntry, recruitMember as GuildMember, {
          title: recruitment.kind === "credit" ? "Credito de recrutamento pendente" : "Recrutamento pendente",
          description: recruitment.kind === "credit"
            ? `Pedido de credito #${recruitment.id} enviado para aprovacao dos Founders.`
            : `Recrutamento #${recruitment.id} enviado para aprovacao dos Founders.`,
          color: 0xf08c00,
          buttonDisabled: true,
          buttonLabel: recruitment.kind === "credit" ? "Credito pendente" : "Recrutamento pendente",
          extraFields: [
            { name: "Recrutador", value: `<@${recruiter.id}>`, inline: true },
            { name: "Recrutamento", value: `#${recruitment.id}`, inline: true }
          ]
        });
      }

      await interaction.editReply(
        [
          recruitment.kind === "credit"
            ? `Pedido de credito #${recruitment.id} criado e pendente de aprovacao.`
            : `Recrutamento #${recruitment.id} criado e pendente de aprovacao.`,
          "Os Founders foram notificados por DM."
        ].filter(Boolean).join("\n")
      );
      logger.info("recruitment.approval_dm_sent", {
        guildId,
        recruitmentId: recruitment.id,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag,
        kind: recruitment.kind,
        sentCount,
        failedCount
      });
    } catch (error) {
      await store.deletePendingRecruitment(recruitment.id);
      logger.error("recruitment.approval_dm_failed", error, {
        guildId,
        recruitmentId: recruitment.id,
        recruiterUserId: recruiter.id,
        recruiterUserTag: recruiter.user.tag,
        recruitUserId: recruitUser.id,
        recruitUserTag: recruitUser.tag
      });
      await interaction.editReply(
        [
          "Nao consegui enviar a ficha por DM para nenhum Founder.",
          "Verifique se existe alguem com o cargo Founder e se a pessoa aceita mensagens diretas deste servidor."
        ].join("\n")
      );
      return;
    }
  }
};

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
