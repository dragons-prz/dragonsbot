# Painel: layout Container (Components V2) — lado do bot

Data: 2026-08-27
Status: Em implementação. Spec canônica em
`dragons-platform/docs/specs/2026-08-27-painel-layout-container-e-emoji.md`.

## Ideia

`PanelConfig.layout: "embed" | "container"` (ausente = `"embed"`).

- `embed`: `EmbedBuilder` (formato atual) — imagem embaixo, `title` sem
  emoji customizado.
- `container`: Components V2 (`ContainerBuilder`) — banner no topo,
  título/descrição como texto markdown, `color` vira accent color.

## Mudanças neste repo

- `src/domain/types.ts`: `PanelLayout` + `PanelConfig.layout`.
- `src/storage/firestore/FirestoreDragonsStore.ts`: `PanelDocument.layout?`;
  `mapPanel` backfill `layout ?? "embed"`; `createPanel` grava
  `layout: "embed"`.
- `src/commands/painel.ts`:
  - `buildPanelComponentRows(panel)` — as linhas de dropdown/botões, comuns
    aos dois layouts.
  - `buildPanelMessage`: ramo `layout === "container"` monta
    `ContainerBuilder` (`MediaGallery` + `TextDisplay` + `ActionRow`s) e
    retorna `{ components: [container], flags: MessageFlags.IsComponentsV2 }`.
  - `publishPanelToChannel`: a flag `IsComponentsV2` não pode ser
    ligada/desligada por `edit()`. Compara
    `existingMessage.flags.has(IsComponentsV2)` com o layout desejado; se
    divergir, `delete()` + `send()` novo (log `panel.layout_reposted`,
    resultado `published`).
- `dispatchPanelAction` (respostas efêmeras): sem mudança, continuam embed.
- README: seção `/painel` (layout), evento `panel.layout_reposted`.

## Validação

`npm run build` (TypeScript strict) passa. discord.js 14.26 já traz os
builders de Components V2. Sem teste de runtime (sem credenciais Discord).
