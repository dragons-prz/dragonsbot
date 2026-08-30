# Painel em blocos (Components V2) — spec canônica

Data: 2026-08-31
Status: Planejado. Recorte da plataforma em
`dragons-platform/docs/specs/2026-08-31-painel-blocos.md`.
Protótipo do layout/editor: artifact "Painel em Blocos".

Entrega em **2 PRs coordenados**: plataforma primeiro (`shared/` + editor),
bot depois. `PanelBlock` e companhia em `src/domain/types.ts` são espelho de
`dragons-platform/shared/src/panel.ts`.

---

## 1. Ideia

O painel deixa de ter um formato fixo (`layout: "embed" | "container"` +
`title`/`description`/`imageUrl`/`buttons`/`select` no topo) e passa a ser
**uma lista ordenada de blocos** renderizada sempre como um **Container
(Components V2)**. O editor da plataforma vira um editor de blocos com
arrastar-para-reordenar; cada bloco de texto ganha uma barra de formatação
(título, negrito, itálico, código, citação) e um seletor de **emojis do
servidor**.

Isso permite botão no meio da mensagem, banner em qualquer posição, vários
blocos de texto com separadores — o layout do exemplo (servidor Turquia).

No editor da plataforma a paleta "Adicionar bloco" fica **acima** da lista
e um bloco novo entra no **topo** (não no fim).

O layout `embed` **é removido**. Todos os painéis existentes já são
Container, então a migração é só reempacotar os campos atuais em blocos, na
leitura (`mapPanel`), sem script de migração.

---

## 2. Modelo (`src/domain/types.ts`)

```ts
export type PanelBlockType = "text" | "image" | "separator" | "buttons" | "select";
export type PanelSeparatorSpacing = "small" | "large";

export interface PanelTextBlock {
  type: "text";
  /** Markdown do Discord (##, **, *, `, >). Renderizado cru num TextDisplay. */
  content: string;
}
export interface PanelImageBlock {
  type: "image";
  /** URL http(s) — vira um MediaGallery (banner) no Container. */
  url: string;
}
export interface PanelSeparatorBlock {
  type: "separator";
  divider: boolean;
  spacing: PanelSeparatorSpacing;
}
export interface PanelButtonsBlock {
  type: "buttons";
  /** 1..25 botões; o render quebra em linhas de 5. `PanelButtonConfig` inalterado. */
  buttons: PanelButtonConfig[];
}
export interface PanelSelectBlock {
  type: "select";
  placeholder: string;
  options: PanelSelectOption[];
}
export type PanelBlock =
  | PanelTextBlock | PanelImageBlock | PanelSeparatorBlock
  | PanelButtonsBlock | PanelSelectBlock;
```

`PanelConfig` passa a ser:

```ts
export interface PanelConfig {
  id: string;
  guildId: string;
  /** Cor de acento do Container (hex `#RRGGBB` ou null). */
  color: string | null;
  blocks: PanelBlock[];
  createdAt: string;
  updatedAt: string;
  publishedChannelId?: string | null;
  publishedMessageId?: string | null;
  /** Campos legados — só lidos pela migração em `mapPanel`, nunca escritos. */
  title?: string;
  description?: string;
  imageUrl?: string | null;
  kind?: "buttons" | "select" | "text";
  layout?: "embed" | "container";
  buttons?: PanelButtonConfig[];
  select?: PanelSelectConfig | null;
}
```

`PanelButtonConfig`, `PanelSelectOption`, `PanelSelectConfig`,
`PanelActionConfig`, `PanelButtonStyle` — **inalterados**. `PanelKind` e
`PanelLayout` deixam de ser usados em `PanelConfig`; mantenha os `type`
exportados só se algo mais os referencia (senão remova).

### Regras

- **≤ 1 bloco `select`** por painel (o `custom_id` continua
  `panelsel:{panelId}`, sem índice — reorder não quebra publicado).
- Botões: id por botão continua único **no painel inteiro** (não por bloco)
  — o `custom_id` publicado é `panel:{panelId}:{buttonId}`.
- Total de botões ≤ 25; blocos ≤ 12 (folga sobre o teto de ~10 componentes
  de topo do Container, contando linhas de botão).
- Um painel publicável tem `blocks.length >= 1`.

---

## 3. Migração na leitura (`mapPanel` / `panel-repository`)

Quando o documento **não** tem `blocks`, montar a partir dos campos legados
(mesma ordem que o formato atual renderiza):

1. `imageUrl` → `{ type: "image", url: imageUrl }`
2. `{ type: "text", content: "## " + title + (description ? "\n\n" + description : "") }`
3. `kind === "select"` && `select` → `{ type: "select", placeholder, options }`
   senão `buttons.length` → `{ type: "buttons", buttons }`

`color` continua no topo (era a cor da barra do Container). Documentos
antigos com `layout: "embed"` também caem nesse mapeamento — viram
Container; `## title` renderiza no TextDisplay.

Escrita (`putPanel`/`updatePanel`): grava só `blocks` + `color` (+ os
campos de publicação). **Não** apaga os legados (inofensivos; `blocks`
tem prioridade na leitura), **não** os reescreve.

---

## 4. Render (`src/commands/painel.ts`)

`buildPanelMessage(panel)` sempre Container V2:

```
c = new ContainerBuilder()
if (panel.color) c.setAccentColor(resolveColor(panel.color))
for (block of panel.blocks) switch (block.type) {
  text:      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content))
  image:     c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
               new MediaGalleryItemBuilder().setURL(block.url)))
  separator: c.addSeparatorComponents(new SeparatorBuilder()
               .setDivider(block.divider)
               .setSpacing(block.spacing === "large" ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small))
  buttons:   chunk(block.buttons, 5).forEach(row => c.addActionRowComponents(buttonRow(panel.id, row)))
  select:    c.addActionRowComponents(selectRow(panel.id, block))
}
return { components: [c], flags: MessageFlags.IsComponentsV2 }
```

- `renderMarkdown`/`## title` manual some — o conteúdo do bloco de texto já
  é markdown do usuário, passado cru.
- `buildPanelComponentRows` (a montagem antiga de linhas) é substituída pela
  iteração de blocos; o helper de linha de botões e o de select são
  reaproveitados.
- `panelIsEmpty(panel)` = `panel.blocks.length === 0`.
- `panelButtonHandler` (`panel:`): procura o botão em
  `panel.blocks.flatMap(b => b.type === "buttons" ? b.buttons : [])`.
- `panelSelectHandler` (`panelsel:`): pega o único bloco `select`.

`layout: "container"` sempre — o ramo `embed` de `buildPanelMessage` e o
`panel.layout_reposted` (repost por troca de layout) somem. Trocar blocos
edita a mensagem publicada normalmente (não precisa repostar; a flag
`IsComponentsV2` já estava ligada em todos).

---

## 5. Comando `/painel`

O editor de verdade é a plataforma; o `/painel` fica como utilitário e
passa a operar sobre blocos:

- `criar id titulo [descricao] [cor]` → `blocks: [{ type:"text",
  content: "## "+titulo + (descricao? "\n\n"+descricao : "") }]`, `color`.
- `set-cor id cor|limpar` → igual (mexe só em `color`).
- `set-imagem id imagem` → upsert de um bloco `image` no topo (ou atualiza
  o primeiro bloco `image`).
- `add-botao ...` → anexa ao último bloco `buttons` (cria um se não houver).
- `remover-botao id botao-id` → remove o botão por id em qualquer bloco
  `buttons`; remove o bloco se ficar vazio.
- `publicar` / `listar` → iguais (`listar` mostra a contagem de blocos).

Reordenar/《separador》/《múltiplos textos》 são só pela plataforma.

---

## 6. Eventos de log / README / AGENTS

- README `/painel`: reescrever a seção para o modelo de blocos; remover
  `layout: "embed"` e `panel.layout_reposted`.
- AGENTS: `PanelBlock` entra na lista de tipos espelho.
- Sem coleção nova; `panels` ganha `blocks` e mantém os legados.

---

## 7. Validação

`npm run build` (tsc strict). Teste manual (criar painel com blocos na
plataforma → publicar → conferir no Discord) depende de credenciais reais —
reportar como não executado.
