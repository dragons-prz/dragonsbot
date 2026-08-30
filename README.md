# Dragons Bot

Bot Discord em TypeScript usando `discord.js` para fluxo de recrutamento com aprovacao por Founder.

## Requisitos

- Node.js 20 ou superior.
- Bot ja criado no Discord Developer Portal.
- Bot adicionado ao servidor com permissoes para:
  - usar comandos de aplicacao
  - ler membros
  - enviar mensagens
  - gerenciar cargos
  - criar topicos privados, enviar mensagens em topicos e gerenciar topicos
    (usado pelo ticket de suporte)
  - marcar `@everyone`, `@here` e todos os cargos (para pingar cargos de
    suporte nao mencionaveis no topico do ticket)

O cargo do bot precisa estar acima do cargo de membro na hierarquia do Discord.

## Instalacao

```bash
npm install
```

Crie o arquivo `.env` a partir do exemplo:

```bash
copy .env.example .env
```

Configure:

```env
DISCORD_CLIENT_ID=1487313181507588117
DISCORD_TOKEN=seu_token
DISCORD_GUILD_ID=id_do_servidor_para_testes
FIREBASE_SERVICE_ACCOUNT_PATH=/caminho/seguro/service-account.json
```

`DISCORD_GUILD_ID` e recomendado em desenvolvimento porque os comandos aparecem imediatamente no servidor informado. Sem ele, os comandos serao registrados globalmente e podem demorar alguns minutos.

Para o Firebase, use o arquivo JSON da service account baixado no console do Firebase:

```env
FIREBASE_SERVICE_ACCOUNT_PATH=/caminho/seguro/service-account.json
```

## Registrar comandos

Em producao (Docker/VPS), o `docker-compose.yml` roda `deploy-commands` a
cada `docker compose up` antes de subir o bot — nenhum passo manual e
necessario apos um deploy que muda comando.

Em desenvolvimento local (fora do Docker):

```bash
npm run deploy:commands
```

## Rodar o bot

Desenvolvimento:

```bash
npm run dev
```

Producao:

```bash
npm run build
npm start
```

## Comandos

### `/config set-role tipo:<recruiter|founder|member> role:<cargo>`

Configura um cargo usado pelo fluxo do bot. Apenas administradores podem usar.

- `recruiter`: cargo que pode usar `/recrutar`.
- `founder`: cargo que pode aprovar recrutamentos.
- `member`: cargo dado ao usuario aprovado.

Valores iniciais usados quando o servidor ainda nao tem configuracao salva:

- recruiter: `1520118976087199754`
- founder: `1487882833761407007`
- member: `1488092923588247563`

### `/config set-channel tipo:approval channel:<canal>`

Configura um canal usado pelo bot. Apenas administradores podem usar.

```text
/config set-channel tipo:approval channel:#canal-de-aprovacoes
/config set-channel tipo:recruitment channel:#recrutamentos
/config set-channel tipo:blacklist channel:#blacklist-logs
/config set-channel tipo:verification channel:#fila-de-verificacao
/config set-channel tipo:exit channel:#saidas
```

Todos os canais ficam salvos no documento `guildConfigs/{guildId}` do Firestore e podem tambem ser editados pelo painel (`dragons-platform`). Quando um campo ainda nao existe no documento, o bot preenche com o default abaixo na primeira leitura.

O fluxo atual envia a aprovacao por DM para todos os membros com cargo `founder`, entao o canal `approval` nao e obrigatorio para recrutar.

| tipo | uso | default |
| --- | --- | --- |
| `recruitment` | anuncio quando um recrutamento e aprovado | `1522080152094249140` |
| `verification` | fila de verificacao de novos membros | `1534723901421256784` |
| `exit` | registro de saida de membros | `1534735482460831884` |
| `blacklist` | logs de adicao/remocao da blacklist | `1541992716496273478` |

### `/config set-number tipo:points valor:<inteiro>`

Configura um parametro numerico do fluxo de recrutamento. Apenas administradores podem usar. Tambem editavel pelo painel.

| tipo | uso | default |
| --- | --- | --- |
| `points` | pontos creditados ao recrutador quando um recrutamento e aprovado | `8` |

### `/config show`

Mostra a configuracao atual de cargos, canais e parametros numericos do servidor. Apenas administradores podem usar.

### `/recrutar usuario:<membro>`

Abre o recrutamento em 3 etapas no proprio canal onde o comando foi usado. Toda a
configuracao do fluxo (cargos, areas, canais, textos, botoes, emojis, pontuacao)
vem do painel `dragons-platform`, nao de comando do bot — ver "Configuracao do
recrutamento" abaixo.

Regras de entrada:

- quem usa o comando precisa ter o cargo `recruiter`
- o fluxo precisa estar configurado no painel (cargos de iniciante, areas e canal da ficha)
- o usuario precisa estar no servidor
- o usuario nao pode estar na blacklist
- nao pode existir outro recrutamento pendente para o mesmo usuario

Se o usuario ja tem o cargo `member`, o recrutamento continua funcionando —
por exemplo para recruta-lo para uma area nova (`Recrutamento`, `Passtime`,
`Suporte`), sem ser a familia. Nao ha janela de tempo nem exigencia de entrada
registrada pelo bot: a aprovacao da gerencia na ficha e a unica trava, e a
mesma pessoa pode ser recrutada mais de uma vez, para areas diferentes, sem
limite.

As etapas, na mensagem publica do canal (so o autor opera os componentes):

1. **Cargo de iniciante** — dropdown com as opcoes cadastradas no painel mais
   uma opcao fixa **"Nenhum cargo"** (para quem ja tem um cargo de
   rank/iniciante — ex.: trazer pra area de Suporte quem ja e "Delusions" —
   sem duplicar cargo de upamento); botao `Cancelar`.
2. **Areas** — dropdown de multipla escolha (minimo e maximo configuraveis); botoes `Voltar` e `Cancelar`.
3. **Confirmacao** — resumo do que foi escolhido; botoes `Confirmar`, `Reiniciar` e `Cancelar`.

`Voltar` volta a etapa 1 mantendo as escolhas; `Reiniciar` zera as selecoes;
`Cancelar` encerra.

**Os desfechos do wizard sao privados.** Enquanto as tres etapas ficam visiveis
para o canal, ao **enviar** ou **cancelar** o bot apaga a mensagem publica do
wizard e responde so ao recrutador (mensagem "Apenas para voce") com o texto
`outcome.submitted` / `outcome.cancelled`. Um rascunho abandonado expira sozinho
(`draftTtlMinutes`, default 15 min): a mensagem publica e apenas apagada, sem
aviso — o worker de expiracao roda sem interacao e nao tem como responder de
forma privada, entao `outcome.expired` fica configurado mas nao e renderizado.

Ao confirmar, o bot posta a **ficha** no canal configurado, com a foto do
recrutado, recrutador, cargo, areas, data de criacao da conta e os botoes
`Confirmar`/`Rejeitar`.

**A configuracao e congelada no `/recrutar`.** Mudar layout, texto ou pontuacao no
painel vale para os proximos recrutamentos: um wizard em andamento termina no
formato em que comecou e uma ficha ja postada continua no formato em que nasceu.
Como as tres etapas vivem na mesma mensagem, editada a cada passo, o layout da
etapa 1 manda em todas as mensagens do wizard (o Discord nao deixa editar uma
mensagem alternando entre embed e Components V2); divergencia e normalizada e
logada em `recruitment.layout_normalized`. A ficha e outra mensagem e tem layout
proprio.

### `/verificar usuario:<membro>`

Verifica um novo membro diretamente. Este comando e usado por Founders e nao cria ficha pendente, nao envia DM de aprovacao e nao adiciona pontos para ninguem.

Regras:

- quem usa o comando precisa ter o cargo `founder`
- o usuario precisa estar no servidor
- o usuario nao pode ja ter o cargo `member`
- o usuario nao pode estar na blacklist
- se houver recrutamento pendente para o mesmo usuario, a verificacao direta e bloqueada

Quando executado com sucesso, o bot aplica o cargo `member`, garante o perfil do membro no Firestore e aplica o rank base configurado na hierarquia.

Se existir recrutamento pendente para o usuario, a verificacao direta e bloqueada para preservar o fluxo de pontos do recrutador.

## Entrada e verificacao por ticket

Quando um membro entra no servidor, o bot so **registra a entrada**
(`MemberEntry`) — nao ha mais card automatico na fila de verificacao. A porta
unica e um **painel de texto "Verificar-se"** (um painel com `kind: "text"` e
um botao com a acao `verification-ticket`).

Fluxo (spec: `docs/specs/2026-08-30-verificacao-recrutamento-por-ticket.md`):

1. O membro clica em **Verificar-se** -> abre um **modal** (`verifyrec:form:`)
   com 2 campos: **Idade** (texto) e **"Veio por alguem?"** (dropdown com a
   lista dos membros do cargo `recruiter`, montada ao vivo, + **Nenhum**).
2. Ao enviar o modal, nasce uma **thread privada** (ticket
   `kind: "verification"`) no canal `verificationTicket.parentChannelId`, com
   as respostas do formulario postadas logo abaixo da mensagem de abertura:
   - **recrutador escolhido** -> a thread menciona so ele; se em
     `verificationTicket.escalateAfterMinutes` (default 60) o membro nao foi
     recrutado, um worker marca o cargo `recruiter` inteiro na thread;
   - **Nenhum** -> a thread ja menciona o cargo `recruiter` e nao escala.
3. Um recrutador roda **`/recrutar @membro` dentro da thread** (mesmo wizard).
   O recrutamento fica vinculado ao ticket.
4. A ficha e roteada pela area escolhida na etapa 2 (ver "Rotas da ficha"
   abaixo). Ao confirmar:
   - **rota Familia**: a thread recebe a mensagem de encerramento, e trancada
     e arquivada, e o ticket fecha. `/recrutar` para a Familia passa a ser
     recusado para esse membro (`blockedAlreadyInFamilyMessage`).
   - **rota Area**: a thread so e arquivada e o ticket fecha.

A mensagem publica do wizard some no envio (o desfecho vai efemero so para o
recrutador), entao a thread nao fica com um `/recrutar` "refazivel".

O botao **Fechar ticket** da thread pode ser usado a qualquer momento pelo
cargo `recruiter`. `/verificar` (Founder) continua como atalho de emergencia.
Os pontos do recrutamento vao sempre para quem roda `/recrutar` (comportamento
inalterado); a resposta do "Veio por alguem?" so define quem e mencionado na
thread e o escalonamento.

## Saidas

Quando um membro sai do servidor, o bot envia um card no canal `exit` (ver `/config set-channel`) com:

- foto/avatar
- nome e mencao
- ID copiavel
- data/hora da saida
- entrada registrada, quando existir
- status conhecido da entrada
- recrutador creditado, quando existir
- recrutamento pendente, quando existir
- cargos conhecidos no momento do evento

O Discord nao informa pelo evento se a pessoa saiu sozinha, foi expulsa ou banida.

## Fila assincrona

As acoes que mexem em cargos e pontos sao processadas pela colecao `memberActionJobs` no Firestore. O bot usa essa colecao como uma fila interna e processa um job por vez.

Tipos de job:

- `verify_member`: usado pelo botao `Verificar` e pelo comando `/verificar`
- `approve_recruitment`: usado pelo botao `Adicionei na familia` e pelo botao `Aprovar credito`

Status de job:

- `pending`
- `processing`
- `completed`
- `failed`
- `cancelled`

Se o bot reiniciar durante um job, jobs travados em `processing` voltam para `pending` automaticamente depois de alguns minutos.

O worker nao faz mais polling fixo. Ele mantem um observador (`onSnapshot`) na
query `status == "pending"` e so consulta o Firestore quando um job entra na
fila. Um `setTimeout` recorrente (60s, com backoff exponencial ate 15min apos
falhas consecutivas) fica de rede de seguranca: destrava jobs presos e cobre o
caso do observador cair. Antes eram dois workers varrendo o Firestore de 5 em 5
segundos para sempre — sozinhos passavam de 60 mil leituras/dia ociosas, o
bastante para estourar a cota diaria do plano Spark.

### `/pontos`

Mostra sua pontuacao atual e a quantidade de recrutamentos aprovados feitos por voce. A resposta e privada.

### `/pontos-dar usuario:<membro> quantidade:<inteiro> motivo:<texto>`

Da ou remove pontos manualmente. Quem pode usar e definido no painel
(`pointsGrantRoleIds`), nao por permissao do Discord. A quantidade aceita valor
negativo e fica limitada a `minManualPoints`/`maxManualPoints`. O `rankName`
mostrado e so o rank teorico (calculado pela pontuacao) — **o bot nao aplica
nem remove cargo de rank**; mudanca de cargo segue o sistema da administracao.

### `/pontos-resetar [usuario:<membro>] [todos:<bool>]`

Zera os **pontos totais**. Informe exatamente um de `usuario` (zera um membro)
ou `todos:True` (zera o servidor inteiro, com botao de confirmacao que so quem
rodou o comando pode clicar). So `points` volta a 0 — `recruitments` e o
historico ficam, e nenhum cargo e mexido. Quem pode usar vem de
`pointsResetRoleIds` no painel; se estiver vazio, cai em `pointsGrantRoleIds`.

### `/ranking limite:<numero>`

Mostra o ranking de membros do servidor, ordenado por pontos e depois por recrutamentos aprovados. O limite e opcional, com padrao 10 e maximo 25. A resposta e privada.

### `/painel`

Um painel e uma **lista ordenada de blocos** (`blocks: PanelBlock[]`), sempre renderizada como um **Container (Components V2)**. Nao ha mais `layout: "embed"` nem `kind`. Tipos de bloco: `text` (markdown), `image` (banner / `MediaGallery`), `separator` (`divider` + `spacing`), `buttons` (1..25, quebrado em linhas de 5) e `select` (no maximo 1 por painel). O editor de verdade e a `dragons-platform` (arrastar para reordenar, barra de formatacao, seletor de emojis do servidor); o `/painel` fica como utilitario. Apenas administradores. Subcomandos:

- `criar id:<texto> titulo:<texto> descricao:<opcional> cor:<opcional>` - cria um painel com um unico bloco de texto (`## titulo`, e `\n\n descricao` se informada). `cor` e hex (ex: `#E03131`).
- `set-imagem id:<texto> imagem:<anexo>` - upsert de um bloco `image` (atualiza o 1o bloco de banner, ou insere um no topo).
- `set-cor id:<texto> cor:<texto>` - define/limpa a cor de acento do container. Aceita hex ou `limpar` (`nenhuma`/`remover`/`none`).
- `add-botao id:<texto> label:<texto> resposta:<texto> estilo:<opcional> emoji:<opcional> resposta-imagem:<opcional> resposta-cor:<opcional>` - anexa um botao ao ultimo bloco `buttons` (cria um se nao houver). `estilo`: Cinza (padrao), Azul, Verde ou Vermelho.
- `remover-botao id:<texto> botao-id:<texto>` - remove o botao por id em qualquer bloco `buttons` (o bloco some se ficar vazio).
- `publicar id:<texto> canal:<canal>` - publica/edita a mensagem no canal. Ja publicado nesse canal -> **edita**; mensagem apagada -> envia nova.
- `listar` - lista os paineis com a quantidade de blocos de cada um.

Os paineis ficam na colecao `panels` do Firestore, compartilhada com a `dragons-platform`. Cada painel guarda `publishedChannelId`/`publishedMessageId` (nulos ate a 1a publicacao) e `color: string | null`. **Migracao:** documentos no formato antigo (`title`/`description`/`imageUrl`/`kind`/`buttons`/`select` no topo, sem `blocks`) sao convertidos na leitura (`mapPanel` / `panelBlocksFromLegacy`) para `[image?, text(## titulo\n\n descricao), buttons|select?]` — sem script; o doc so ganha `blocks` no proximo save.

**Acoes (`action`).** Cada botao **e** cada opcao de dropdown carrega uma `PanelActionConfig`:

- `{ type: "reply", response, responseImageUrl, responseColor }` - o comportamento historico (embed efemero). Documentos antigos sem `action` sao lidos como esta acao, montada a partir dos campos legados do botao.
- `{ type: "run", actionId, params }` - dispara uma acao registrada no bot (`src/commands/panel-actions/registry.ts`). Hoje ha duas: `support-ticket` e `verification-ticket` (ver abaixo). O `/painel add-botao` so cria acoes `reply`; acoes `run` sao configuradas pela `dragons-platform`.

### Verificacao (acao `verification-ticket`)

Um botao com `action: { type: "run", actionId: "verification-ticket" }` (sem
`params`) e o "Verificar-se". Ao clicar, o bot abre um **modal** com dois
campos — **Idade** (texto) e **"Veio por alguem?"** (dropdown com os membros
do cargo `recruiter` + "Nenhum") — e, ao enviar, cria a thread privada do
ticket de verificacao. Toda a config vem de
`recruitmentConfigs/{guildId}.verificationTicket` (escrita so pela
`dragons-platform`): `parentChannelId`, `formTitle`, `ageLabel`,
`agePlaceholder`, `recruiterPickerLabel`, `recruiterPickerPlaceholder`,
`noRecruiterLabel`, `threadNameTemplate` (`{user}` `{date}` `{shortid}`),
`openMessage` (`{user}` `{recruiter}`), `escalationMessage` (`{user}`),
`closeMessage` (`{user}` `{closer}`), `escalateAfterMinutes`. Ver a
secao "Entrada e verificacao por ticket" acima e
`docs/specs/2026-08-30-verificacao-recrutamento-por-ticket.md`.

### Ticket de suporte (acao `support-ticket`)

Uma opcao de dropdown (ou botao) com `action: { type: "run", actionId: "support-ticket", params: { category } }` abre um **topico privado** de atendimento quando acionada. O `params.category` referencia uma **categoria de suporte** (`supportCategories/{guildId}_{id}`), configurada **so pela `dragons-platform`** — o bot apenas le. Cada categoria define: `parentChannelId` (canal de texto onde o topico privado nasce), `supportRoleIds` (marcados no topico e unicos que podem Atender/Fechar), `viewerRoleIds` (cargos que so visualizam), `threadNameTemplate` (variaveis: `{user}` = nome do autor em slug, `{date}` = AAAAMMDD, `{shortid}` = prefixo do id do ticket; sem `{date}`/`{shortid}` o nome se repete a cada ticket da mesma pessoa, o que o Discord permite mas confunde o suporte), e os templates `openMessage` / `claimMessage` / `closeMessage` (aceitam `{user}`, `{claimer}`, `{closer}`).

Fluxo:

1. Ao escolher a opcao, o bot reserva a trava `openTicketKeys/{guildId}_{userId}` (**1 ticket aberto por usuario**), cria o topico privado, adiciona o autor, e posta uma mensagem marcando os cargos de suporte/visualizacao com os botoes **"Atender ticket"** e **"Fechar ticket"**. O ticket vai para `tickets/{ticketId}` com `status: "open"`.
2. **Atender ticket** (so cargo de suporte): transacao `open -> claimed`, posta "\<suporte\> esta atendendo o ticket de \<autor\>" no topico e desabilita o botao "Atender".
3. **Fechar ticket** (so cargo de suporte): transacao `-> closed`, libera a trava do autor, posta a `closeMessage`, remove o autor do topico privado, tranca e arquiva o topico (`closeAction: "archive-remove"`).

`TicketRecord` guarda ainda `feedbackRating` / `feedbackComment` (nulos por enquanto — o fluxo de feedback e uma fase futura). Ver `docs/specs/2026-08-27-painel-acoes-e-ticket-suporte.md`.

### Fila de publicacao de paineis (`panelJobs`)

A interface web nao publica paineis diretamente no Discord: a montagem da mensagem (embed + linhas de botoes) e uma unica fonte de verdade que mora neste bot. Em vez disso, o painel web grava um job na colecao `panelJobs` do Firestore e o bot consome essa fila, do mesmo jeito que `memberActionJobs` funciona para recrutamento/verificacao.

Campos de cada job:

- `id`, `guildId`, `panelId`, `channelId`, `requestedByUserId`
- `status`: `pending`, `processing`, `completed` ou `failed`
- `messageId`: preenchido quando o job e concluido
- `attempts`, `error`, `createdAt`, `updatedAt`

O worker interno e acordado por um observador (`onSnapshot`) da query de jobs `pending` — nao ha mais polling fixo de 5 segundos (ver "Fila assincrona" acima para o motivo e para a rede de seguranca com backoff). Ao acordar, pega o job `pending` mais antigo (numa transacao, para dois processos nunca pegarem o mesmo job), publica a mensagem do painel (editando a mensagem existente quando o painel ja foi publicado nesse mesmo canal, ou enviando uma nova quando essa mensagem foi apagada ou nao existe ainda) e marca o job como `completed` com o `messageId` resultante. Se qualquer etapa falhar, o job vira `failed` com uma mensagem de erro legivel e o worker continua processando os proximos jobs normalmente. Jobs travados em `processing` por mais de 5 minutos (por exemplo, apos um reinicio do bot) voltam automaticamente para `pending`.

### `/blacklist`

Gerencia a lista de usuarios que nunca podem ser verificados ou recrutados. Apenas quem tem o cargo `founder` pode usar. Subcomandos:

- `add usuario:<membro> motivo:<texto>` - adiciona o usuario na blacklist. Founders nao podem ser adicionados (o comando bloqueia essa tentativa).
- `remove usuario:<membro>` - remove o usuario da blacklist.
- `listar` - lista os usuarios atualmente na blacklist com o motivo e quem adicionou.

Enquanto um usuario estiver na blacklist, `/recrutar` e `/verificar` ficam bloqueados para ele, mostrando o motivo do bloqueio. Toda adicao/remocao gera um log com foto do usuario, motivo e responsavel no canal `blacklist` (veja `/config set-channel`). Os registros ficam na colecao `blacklist` do Firestore.

## Rotas da ficha

A ficha e postada num canal que depende da area escolhida na etapa 2:

- se a area marcada como **Familia** (`familyAreaId`) estiver entre as
  escolhidas -> **rota Familia**: canal `familyRoute.sheetChannelId`,
  confirmada pelos cargos `familyRoute.approverRoleIds` (os Founders,
  "Verificacao das Posses");
- senao -> **rota Area**: canal `areaRoute.sheetChannelId`, confirmada pelos
  cargos `areaRoute.approverRoleIds` (lideranca de REC).

O canal e os cargos da rota sao **congelados no envio** (no
`sheetPresentation`, junto de `routeKind`), entao editar a config no painel so
vale para fichas novas. `maxAreas` nasce em `1` para nao misturar rotas;
recrutamento legado (sem `sheetPresentation`) cai no `approverRoleIds` do topo.

## Aprovacao

Os botoes da ficha so podem ser usados por quem tem um dos cargos aprovadores
da rota congelada na ficha (`familyRoute`/`areaRoute`); recrutamento legado cai
no `approverRoleIds` do topo. O cargo `founder` continua mandando na entrada de
membro, nao aqui.

Ao **confirmar**, a acao entra na fila `memberActionJobs` (que serializa as
escritas) e o bot:

- muda o recrutamento para `approved`
- aplica o cargo `member` e o **rank base** (`Novato`)
- aplica o cargo de iniciante escolhido (nenhum, se a etapa 1 usou "Nenhum
  cargo") e os cargos de todas as areas escolhidas
- credita ao recrutador os pontos congelados na ficha (soma dos pontos das areas,
  ou o maior deles se `pointsMode` for `highest`)
- **nao** sobe/desce cargo de rank (sem up automatico — so o rank base entra)
- anuncia o recrutamento no canal de recrutamento
- edita a ficha para o estado "aprovada", com os botoes desativados
- se o `/recrutar` rodou num ticket de verificacao: rota Familia -> encerra e
  arquiva a thread + fecha o ticket; rota Area -> so arquiva a thread + fecha o
  ticket

Ao **rejeitar**, nada de cargo ou ponto acontece: o recrutamento vira `rejected`,
a entrada do membro volta a ficar livre (um novo `/recrutar` para o mesmo usuario
passa a ser aceito) e a ficha e editada para o estado "rejeitada".

Em pedidos de credito posterior o membro ja possui os cargos; a aprovacao apenas
soma os pontos, marca a entrada como creditada e atualiza o card de verificacao.

Recrutamentos criados pelo fluxo antigo (aprovacao por DM aos Founders) continuam
funcionando: o botao `Adicionei na familia` segue registrado ate drenarem.

## Configuracao do recrutamento

O documento `recruitmentConfigs/{guildId}` e escrito **so** pela
`dragons-platform` (tela "Recrutamento"); o bot apenas le. Nao existe comando de
`/config` para isso. Ele guarda:

- `starterRoles`: opcoes da etapa 1, cada uma com um cargo do Discord.
- `areas`: opcoes da etapa 2, cada uma com 1..n cargos e uma pontuacao.
- `minAreas` / `maxAreas` (default `1`), `pointsMode` (`sum` default, ou `highest`).
- `familyAreaId`, `familyRoute` / `areaRoute` (canal da ficha + cargos que
  confirmam, por rota — ver "Rotas da ficha").
- `verificationTicket`: canal-pai da thread, templates (`threadNameTemplate`,
  `openMessage`, `escalationMessage`, `closeMessage`), `escalateAfterMinutes`,
  `recruiterPickerPlaceholder`, `noRecruiterLabel`.
- `pointsResetRoleIds`: cargos do `/pontos-resetar` (vazio = `pointsGrantRoleIds`).
- `blockedAlreadyInFamilyMessage`: bloqueio do `/recrutar` para quem ja entrou
  na Familia.
- `sheet`: formato das mensagens da ficha (pendente, enfileirada, aprovada,
  rejeitada), botoes, posicao da foto e se marca os aprovadores. `sheet.channelId`
  e o `approverRoleIds` do topo ficam como fallback dos recrutamentos legados.
- `stepOne` / `stepTwo` / `stepThree` / `outcome`: uma `RecruitmentMessageConfig`
  por mensagem (layout `embed`/`container`, titulo, texto, cor, imagem) e os
  botoes de cada etapa (texto, emoji e cor). `outcome.submitted` e
  `outcome.cancelled` sao enviados so ao recrutador (mensagem "Apenas para
  voce"); `outcome.expired` fica configurado mas nao e renderizado (a mensagem
  publica so e apagada ao expirar).
- `approverRoleIds` (legado), `pointsGrantRoleIds`, `pointsResetRoleIds`,
  `minManualPoints`/`maxManualPoints`, `draftTtlMinutes` e os textos avulsos
  (placeholders e mensagens de bloqueio).

Titulo e texto sao templates: `{recruited}`, `{recruiter}`, `{role}`, `{areas}`,
`{step}`, `{total}`, `{min}`, `{max}`, `{points}`, `{createdAt}`, `{approver}`,
`{recruitedId}`, `{recruiterId}`, `{recruitedTag}`, `{recruiterTag}`. O que nao
casar fica intacto na mensagem.

Emoji customizado precisa ser `<:nome:id>` (ou `<a:nome:id>`); `:atalho:` nao e
resolvido pela API e apareceria como texto cru — o painel rejeita esse formato.

Documento ausente ou parcial cai nos defaults de
`DEFAULT_RECRUITMENT_FLOW_CONFIG` (`src/domain/types.ts`), que sao os mesmos
aplicados pela plataforma. Sem cargos de iniciante, sem areas ou sem canal da
ficha, o `/recrutar` responde a mensagem de "fluxo nao configurado".

## Hierarquia

A pontuacao fica na entidade generica de membro, nao em uma entidade exclusiva de recrutador. Hoje recrutamento soma pontos nessa entidade, e futuras areas tambem poderao somar pontos no mesmo perfil.

A hierarquia e configurada no Firestore pela colecao `hierarchyRoles`. O bot cria uma configuracao inicial automaticamente, mas os cargos e pontos podem ser editados diretamente na base. Nao ha UI na `dragons-platform` para isso.

**Nao ha mais up automatico.** O bot calcula o `rankName` teorico pela
pontuacao (mostrado em `/pontos` e `/ranking`) e aplica so o **rank base**
(`Novato`) na entrada, junto do cargo `member`. Subir ou descer de cargo de
rank e **manual** — segue o sistema da administracao. `hierarchyRoles` fica
como dado de exibicao; o bot nao faz mais `roles.add`/`roles.remove` de rank
nem manda DM de "voce subiu".

Campos de cada documento:

- `guildId`: ID do servidor.
- `name`: nome do rank.
- `roleId`: ID do cargo no Discord.
- `points`: pontos minimos para atingir o rank.
- `order`: ordem do rank, usada como desempate e organizacao.

Os pontos continuam acumulando (recrutamento aprovado, `/pontos-dar`) e
`/pontos-resetar` os zera. O campo `recruitments` continua no perfil do membro
apenas como estatistica e nao e afetado pelo reset.

## Banco de dados

O bot usa Firebase Firestore. A interface `DragonsStore` foi mantida para permitir trocar de banco futuramente sem alterar os comandos.

Colecoes usadas no Firestore:

- `guildConfigs`
- `recruitments`
- `members`
- `memberPointEvents`
- `hierarchyRoles`
- `counters`
- subcolecao `recruitments/{id}/approvalMessages`
- `memberEntries`
- `memberActionJobs`
- `recruitmentConfigs` (configuracao do fluxo de recrutamento; escrita so pela `dragons-platform`)
- `recruitmentDrafts` (rascunhos do wizard de 3 etapas; escrita so pelo bot, apagados ao expirar)
- `panels`
- `panelJobs`
- `supportCategories` (categorias de ticket; escrita so pela `dragons-platform`)
- `tickets` (tickets de suporte **e** de verificacao; escrita so pelo bot — o
  campo `kind` distingue `"support"` de `"verification"`)
- `openTicketKeys` (trava de 1 ticket aberto por usuario)
- `blacklist`

Se ja houver dados antigos em `recruiterPoints`/`recruiterPointEvents`, migre para a estrutura generica:

```bash
npm run migrate:firestore-members
```

## Logs

O bot escreve logs estruturados em JSON no console, um evento por linha. Em VPS com systemd, use:

```bash
journalctl -u dragons-bot -f
```

Eventos principais:

- `interaction.command.received`
- `interaction.command.completed`
- `interaction.button.received`
- `interaction.button.completed`
- `recruitment.requested`
- `recruitment.draft_created` / `recruitment.draft_blocked`
- `recruitment.draft_role_selected` / `recruitment.draft_areas_selected`
- `recruitment.draft_back` / `recruitment.draft_restarted` / `recruitment.draft_cancelled`
- `recruitment.draft_expired` / `recruitment.draft_expire_edit_failed` / `recruitment.draft_expiry_failed`
- `recruitment.layout_normalized` (etapas com layouts diferentes; o da etapa 1 vale para o wizard)
- `recruitment.sheet_sent` / `recruitment.sheet_channel_not_found` / `recruitment.sheet_edit_failed`
- `recruitment.sheet_blocked` (clique na ficha sem cargo aprovador)
- `recruitment.approval_enqueued` / `recruitment.approved` / `recruitment.rejected`
- `recruitment.starter_role_add_failed` / `recruitment.area_role_add_failed`
- `recruitment_config.missing` (fluxo nao configurado no painel)
- `recruitment.created`
- `recruitment.approval_dm_sent` (fluxo antigo, por DM)
- `recruitment.blocked`
- `recruitment.approval_blocked`
- `config.role_set`
- `config.channel_set`
- `config.number_set`
- `points.viewed`
- `points.granted_manual` / `points.grant_blocked`
- `points.reset` / `points.reset_blocked`
- `ranking.viewed`
- `panel.created`
- `panel.image_set`
- `panel.button_added`
- `panel.button_removed`
- `panel.published_message_missing`
- `panel_job.claimed`
- `panel_job.published`
- `panel_job.updated`
- `panel_job.failed`
- `panel_job.stale_reset`
- `panel_job.worker_failed` (inclui `consecutiveFailures` e `nextRetryMs` do backoff)
- `panel_job.watch_failed` (observador `onSnapshot` caiu; reassina sozinho)
- `panel.action_run` / `panel.action_unknown`
- `panel.reposted_as_v2` (mensagem publicada legada sem a flag Components V2; apagada e repostada)
- `ticket.opened` / `ticket.open_denied` / `ticket.open_failed`
- `ticket.claimed` / `ticket.closed`
- `ticket.opener_add_failed` / `ticket.ping_edit_failed`
- `verification_ticket.opened` / `verification_ticket.open_denied` / `verification_ticket.open_failed`
- `verification_ticket.recruiter_list_truncated` / `verification_ticket.opener_add_failed`
- `verification_ticket.escalated` / `verification_ticket.escalate_failed` / `verification_ticket.escalation_tick_failed`
- `verification_ticket.recruited_family` / `verification_ticket.recruited_area` / `verification_ticket.finalize_failed`
- `verification_ticket.link_failed`
- `member_entry.registered` (entrada de membro — sem mais card automatico)
- `interaction.select.received` / `interaction.select.completed`
- `interaction.modal.received` / `interaction.modal.completed` / `interaction.modal.unknown`
- `member_action_job.failed`
- `member_action_job.restore_ui_failed`
- `member_action_job.stale_reset`
- `member_action_job.worker_failed` (inclui `consecutiveFailures` e `nextRetryMs` do backoff)
- `member_action_job.watch_failed` (observador `onSnapshot` caiu; reassina sozinho)
- `blacklist.added`
- `blacklist.removed`
- `blacklist.blocked`
- `firestore.usage` (agregado a cada 5min: `reads`/`writes`/`totalCalls` + `byMethod`)

## Observabilidade (New Relic APM)

O agente do New Relic e carregado no primeiro `import` de `src/index.ts` e
configurado por `newrelic.js` (le so variavel de ambiente, sem segredo no
arquivo). Sem `NEW_RELIC_LICENSE_KEY` o agente fica desativado — dev, `npm start`
local e CI rodam normalmente sem ele.

Variaveis (ver `.env.example`):

| Var | |
| --- | --- |
| `NEW_RELIC_LICENSE_KEY` | Secret. So no `.env` da VPS (o `docker-compose` carrega via `env_file`). Nunca no Dockerfile, na imagem ou no git. |
| `NEW_RELIC_APP_NAME` | Nome da app no New Relic (`dragonsbot`). |
| `NEW_RELIC_LOG` / `NEW_RELIC_LOG_LEVEL` | Destino (`stdout`) e nivel do log do agente. |
| `NEW_RELIC_LOG_FORWARDING` | `false` para nao encaminhar logs da app (economiza o teto de ingest do plano free). |
| `FIRESTORE_USAGE_LOG` | `false` para desligar o log agregado `firestore.usage` (independente do New Relic). |

O bot nao e servidor HTTP, entao a auto-instrumentacao nao gera "transactions"
sozinha. O que existe:

- **Background transactions** manuais: cada slash command
  (`OtherTransaction/command/<nome>`), clique de botao
  (`OtherTransaction/button/<prefixo>`) e job
  (`OtherTransaction/job/panel_job`, `.../member_action_job/<tipo>`).
- **Camada de dados** (`src/storage/instrumentedStore.ts`): um `Proxy` sobre o
  `DragonsStore` cria um segmento `Datastore/statement/Firestore/<metodo>` por
  chamada (aparece no trace de cada transacao e, parcialmente, na aba
  Databases), emite metricas `Custom/Firestore/*` e loga um agregado
  `firestore.usage` a cada 5min com contagem/latencia por metodo — sinal de
  volume que **nao depende do New Relic nem do plano do Firebase**.
- **Logs** (`src/utils/logger.ts`): cada linha e encaminhada por
  `newrelic.recordLogEvent(...)`. O agente so auto-instrumenta winston/pino/
  bunyan; este logger e `console` puro, entao sem esse encaminhamento explicito
  a aba Logs do APM fica vazia. Desligavel com `NEW_RELIC_LOG_FORWARDING=false`.
- De graca do agente: runtime/GC, erros e chamadas externas (Discord API).

## Validacao

```bash
npm run build
```

Checklist manual recomendado:

- configurar cargos com `/config`
- tentar recrutar sem cargo de recrutador e confirmar bloqueio
- recrutar com cargo correto e confirmar DM para Founders
- verificar com Founder e confirmar cargo de membro + rank base sem pontos para ninguem
- confirmar que novo membro gera card no canal de verificacao
- confirmar que `/recrutar` para um membro ja verificado (sem limite de tempo) gera pedido de credito, inclusive para uma area diferente da familia
- confirmar que segundo pedido de credito para o mesmo membro e bloqueado
- usar `/pontos` e confirmar a pontuacao atual
- usar `/ranking` e confirmar a ordenacao por pontos/recrutamentos
- tentar aprovar sem cargo Founder e confirmar bloqueio
- aprovar com Founder e confirmar cargo de membro + os pontos configurados (default 8)
- tentar aprovar novamente e confirmar que nao duplica pontos
