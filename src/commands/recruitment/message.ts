import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ColorResolvable,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageActionRowComponentBuilder,
  MessageFlags,
  resolveColor,
  SectionBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} from "discord.js";

import {
  PanelButtonStyle,
  RecruitmentAvatarPlacement,
  RecruitmentButtonConfig,
  RecruitmentMessageConfig
} from "../../domain/types";
import { renderTemplate } from "../../utils/discord";

const BUTTON_STYLE_MAP: Record<PanelButtonStyle, ButtonStyle> = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger
};

export interface RecruitmentButtonSpec {
  customId: string;
  config: RecruitmentButtonConfig;
  disabled?: boolean;
}

export interface RecruitmentSelectSpec {
  customId: string;
  placeholder: string;
  minValues: number;
  maxValues: number;
  options: {
    id: string;
    label: string;
    description: string | null;
    emoji: string | null;
  }[];
  selectedIds?: string[];
}

export interface BuildRecruitmentMessageInput {
  message: RecruitmentMessageConfig;
  vars: Record<string, string>;
  buttons?: RecruitmentButtonSpec[];
  select?: RecruitmentSelectSpec | null;
  /** URL da foto do recrutado; so e usada quando `avatarPlacement` pede. */
  avatarUrl?: string | null;
  avatarPlacement?: RecruitmentAvatarPlacement;
}

function buildButtonRows(buttons: RecruitmentButtonSpec[]) {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const chunk = buttons.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        chunk.map((spec) => {
          const builder = new ButtonBuilder()
            .setCustomId(spec.customId)
            .setStyle(BUTTON_STYLE_MAP[spec.config.style])
            .setDisabled(spec.disabled ?? false);
          // O Discord aceita botao so com emoji, mas nao aceita botao sem
          // label E sem emoji — a validacao do painel ja barra esse caso.
          if (spec.config.label.trim()) {
            builder.setLabel(spec.config.label);
          }
          if (spec.config.emoji) {
            builder.setEmoji(spec.config.emoji);
          }
          return builder;
        })
      )
    );
  }
  return rows;
}

function buildSelectRow(select: RecruitmentSelectSpec) {
  const selected = new Set(select.selectedIds ?? []);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(select.customId)
    .setPlaceholder(select.placeholder || "Selecione uma opcao")
    .setMinValues(Math.max(1, Math.min(select.minValues, select.options.length || 1)))
    .setMaxValues(Math.max(1, Math.min(select.maxValues, select.options.length || 1)))
    .addOptions(
      select.options.map((option) => {
        const builder = new StringSelectMenuOptionBuilder()
          .setLabel(option.label)
          .setValue(option.id)
          .setDefault(selected.has(option.id));
        if (option.description) {
          builder.setDescription(option.description);
        }
        if (option.emoji) {
          builder.setEmoji(option.emoji);
        }
        return builder;
      })
    );

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

/**
 * Monta o payload de uma mensagem do fluxo de recrutamento nos dois
 * formatos, do mesmo jeito que `buildPanelMessage` faz para os paineis:
 *
 * - `layout: "embed"`: `{ embeds, components }` — imagem embaixo, foto do
 *   recrutado como thumbnail nativa.
 * - `layout: "container"`: Components V2 — a foto vira accessory de uma
 *   `Section` (miniatura a direita) ou banner numa `MediaGallery`, e o
 *   titulo/descricao viram markdown (unico formato em que emoji customizado
 *   do servidor renderiza no titulo).
 *
 * `message` vem SEMPRE do snapshot do rascunho/recrutamento, nunca da
 * configuracao viva: e o que garante que o formato de uma mensagem ja
 * postada nunca mude, e por isso nada aqui precisa apagar e repostar.
 */
export function buildRecruitmentMessage(input: BuildRecruitmentMessageInput) {
  const { message, vars } = input;
  const title = renderTemplate(message.title, vars);
  const description = renderTemplate(message.description, vars);
  const placement = input.avatarPlacement ?? "none";
  const avatarUrl = placement === "none" ? null : (input.avatarUrl ?? null);

  const rows = [
    ...(input.select ? [buildSelectRow(input.select)] : []),
    ...buildButtonRows(input.buttons ?? [])
  ];

  if (message.layout === "container") {
    const container = new ContainerBuilder();
    if (message.color) {
      container.setAccentColor(resolveColor(message.color as ColorResolvable));
    }

    const bannerUrl = message.imageUrl ?? (placement === "image" ? avatarUrl : null);
    if (bannerUrl) {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(bannerUrl))
      );
    }

    const text = `## ${title}\n${description}`;
    if (placement === "thumbnail" && avatarUrl) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
      );
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    }

    for (const row of rows) {
      container.addActionRowComponents(row);
    }

    return { components: [container], flags: MessageFlags.IsComponentsV2 as const };
  }

  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setTimestamp();
  if (message.color) {
    embed.setColor(resolveColor(message.color as ColorResolvable));
  }
  if (placement === "thumbnail" && avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }
  const imageUrl = message.imageUrl ?? (placement === "image" ? avatarUrl : null);
  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return { embeds: [embed], components: rows };
}
