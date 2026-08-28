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

### `/config set-number tipo:<points|credit-window-hours> valor:<inteiro>`

Configura um parametro numerico do fluxo de recrutamento. Apenas administradores podem usar. Tambem editavel pelo painel.

| tipo | uso | default |
| --- | --- | --- |
| `points` | pontos creditados ao recrutador quando um recrutamento e aprovado | `8` |
| `credit-window-hours` | janela (horas) apos a entrada em que ainda cabe pedir credito de recrutamento | `24` |

### `/config show`

Mostra a configuracao atual de cargos, canais e parametros numericos do servidor. Apenas administradores podem usar.

### `/recrutar usuario:<membro>`

Cria uma ficha de recrutamento pendente.

Regras:

- quem usa o comando precisa ter o cargo `recruiter`
- o usuario precisa estar no servidor
- o usuario nao pode estar na blacklist
- nao pode existir outro recrutamento pendente para o mesmo usuario
- precisa existir pelo menos um Founder com DM aberta para receber a aprovacao

Se o usuario ainda nao tem o cargo `member`, o fluxo e o recrutamento normal.

Se o usuario ja tem o cargo `member`, o comando vira um pedido de credito de recrutamento. Esse pedido so e aceito quando:

- o bot registrou a entrada do membro
- a entrada aconteceu dentro da janela de credito (`credit-window-hours`, default 24h)
- o membro ainda nao possui recrutador creditado
- nao existe outro recrutamento ou credito pendente

Quando criado com sucesso, o bot envia uma DM para todos os Founders com:

- mencao do usuario recrutado
- ID do usuario em formato copiavel
- recrutador
- instrucao para adicionar o usuario na familia do servidor da Pureza
- botao `Adicionei na familia`

Para credito posterior, a DM informa que o membro ja foi verificado e mostra o botao `Aprovar credito`.

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

## Fila de verificacao

Quando um membro entra no servidor, o bot envia um card no canal `verification` (ver `/config set-channel`) com:

- mencao ao cargo `founder` configurado
- foto/avatar
- nome e mencao
- ID copiavel
- data/hora de entrada
- botao `Verificar`

O botao so pode ser usado por Founders. Ao clicar, o bot coloca a verificacao na fila, muda o card para `Verificacao enfileirada` e responde rapidamente. Um worker interno processa a fila em seguida, aplica os cargos corretos, marca a entrada como verificada diretamente e desativa o botao.

Se um recrutador usar `/recrutar` antes da verificacao direta, o card vira `Recrutamento pendente` e o botao de verificacao direta e desativado.

Se um recrutador usar `/recrutar` depois da verificacao direta, dentro da janela de credito (`credit-window-hours`, default 24h), o card vira `Credito de recrutamento pendente`. Quando um Founder aprovar, o recrutador recebe pontos e o card vira `Credito de recrutamento aprovado`.

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

### `/ranking limite:<numero>`

Mostra o ranking de membros do servidor, ordenado por pontos e depois por recrutamentos aprovados. O limite e opcional, com padrao 10 e maximo 25. A resposta e privada.

### `/painel`

Cria paineis informativos: uma mensagem com titulo, descricao, imagem opcional, cor lateral opcional e ate 25 botoes, organizados em linhas de 5. Ao clicar em um botao, o usuario recebe uma resposta privada (visivel so para ele) em formato de embed, com o texto, a imagem e a cor configurados para aquele botao — por ser um embed, a resposta sempre tem a barra colorida do Discord a esquerda, mesmo quando nenhuma cor customizada foi definida (nesse caso o Discord usa a cor padrao dele). Apenas administradores podem usar. Subcomandos:

- `criar id:<texto> titulo:<texto> descricao:<texto> cor:<opcional>` - cria um painel novo (id e usado internamente, deve ser unico no servidor). `cor` e hex (ex: `#E03131`); se informada com formato invalido, o comando recusa com uma mensagem de erro.
- `set-imagem id:<texto> imagem:<anexo>` - define/atualiza a imagem do painel.
- `set-cor id:<texto> cor:<texto>` - define/atualiza a cor lateral do embed do painel. Aceita hex (ex: `#E03131`) ou a palavra `limpar` (tambem aceita `nenhuma`, `remover`, `none`) para voltar a cor padrao do Discord (`color: null`).
- `add-botao id:<texto> label:<texto> resposta:<texto> estilo:<opcional> emoji:<opcional> resposta-imagem:<opcional> resposta-cor:<opcional>` - adiciona um botao. `estilo` pode ser Cinza (padrao), Azul, Verde ou Vermelho. `resposta-imagem` e um anexo exibido na resposta ao clicar; `resposta-cor` e hex (ex: `#E03131`) para a cor lateral dessa resposta. Ambos sao opcionais e ficam `null` quando omitidos.
- `remover-botao id:<texto> botao-id:<texto>` - remove um botao pelo id gerado a partir do label. Nao existe "editar botao": para mudar label, resposta, imagem ou cor de um botao ja existente, remova e recrie com `add-botao`.
- `publicar id:<texto> canal:<canal>` - publica a mensagem do painel no canal indicado. Se o painel ja tiver sido publicado antes nesse mesmo canal (`publishedChannelId`/`publishedMessageId`), o comando **edita** a mensagem existente em vez de enviar uma nova; se a mensagem publicada anteriormente tiver sido apagada, ele envia uma nova mensagem normalmente. A resposta do comando deixa claro se o painel foi publicado ou atualizado.
- `listar` - lista os paineis do servidor com a quantidade de botoes/opcoes de cada um.

Os paineis ficam salvos na colecao `panels` do Firestore, o que permite reconfigurar sem reiniciar o bot e e usada pela interface web de configuracao (`dragons-platform`) para criar e editar paineis. Cada painel guarda `publishedChannelId`/`publishedMessageId` (nulos ate a primeira publicacao) para saber onde a mensagem foi publicada por ultimo, alem de `color: string | null` (cor lateral do embed principal, hex tipo `#E03131`). Cada botao (`PanelButtonConfig`) guarda tambem `responseImageUrl: string | null` (imagem exibida na resposta) e `responseColor: string | null` (cor lateral da resposta). Documentos criados antes dessa mudanca nao tem esses campos gravados no Firestore; o bot os trata como ausentes = `null` ao ler, sem quebrar.

**Layout do painel (`layout`).** `layout: "embed" | "container"` (ausente = `"embed"`). No `embed` (formato historico) a imagem fica embaixo e o `title` do embed nao renderiza emoji customizado do servidor. No `container` a mensagem usa **Components V2** (`ContainerBuilder`): a imagem vira um banner no topo e o titulo/descricao viram texto markdown (emoji de qualquer tipo, em qualquer lugar). A flag `IsComponentsV2` **nao pode ser ligada/desligada editando** uma mensagem ja publicada — quando o `layout` de um painel publicado muda, o `publishPanelToChannel` apaga a mensagem antiga e reposta uma nova (evento `panel.layout_reposted`, `panelJob` fica `published` em vez de `updated`).

**Tipo do painel e acoes (`kind` / `action`).** Um painel tem `kind: "buttons" | "select"` (ausente = `"buttons"`). Quando `kind === "select"`, o painel mostra um unico dropdown (`PanelSelectConfig`: `placeholder` + `options[]`) no lugar das linhas de botoes; cada opcao tem `label`, `description`, `emoji` e uma acao. Cada botao **e** cada opcao carrega uma `PanelActionConfig`:

- `{ type: "reply", response, responseImageUrl, responseColor }` - o comportamento historico (embed efemero). Documentos antigos sem `action` sao lidos como esta acao, montada a partir dos campos legados do botao.
- `{ type: "run", actionId, params }` - dispara uma acao registrada no bot (`src/commands/panel-actions/registry.ts`). Hoje ha uma: `support-ticket` (ver abaixo). O `/painel add-botao` so cria acoes `reply`; acoes `run` sao configuradas pela `dragons-platform`.

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

Enquanto um usuario estiver na blacklist, `/recrutar`, `/verificar` e o botao `Verificar` do card de entrada ficam bloqueados para ele, mostrando o motivo do bloqueio. Toda adicao/remocao gera um log com foto do usuario, motivo e responsavel no canal `blacklist` (veja `/config set-channel`). Os registros ficam na colecao `blacklist` do Firestore.

## Aprovacao

O botao `Adicionei na familia` so pode ser usado por membros com o cargo `founder`.

Ao aprovar:

- o recrutamento muda para `approved`
- o usuario recrutado recebe o cargo `member`
- o recrutador recebe os pontos configurados (`points`, default 8)
- o canal de recrutamento recebe um anuncio informando quem foi recrutado e por quem
- os pontos entram no perfil generico de membro
- se o recrutador atingir a pontuacao de um novo rank, o cargo de hierarquia e atualizado automaticamente
- quando houver promocao, o recrutador recebe uma DM informando o novo cargo
- as DMs enviadas aos Founders sao atualizadas para mostrar a aprovacao
- o botao e desativado para evitar pontos duplicados

Em pedidos de credito posterior, o membro ja possui os cargos. Nesse caso a aprovacao apenas soma os pontos ao recrutador, marca a entrada como creditada e atualiza o card de verificacao.

## Hierarquia

A pontuacao fica na entidade generica de membro, nao em uma entidade exclusiva de recrutador. Hoje recrutamento soma pontos nessa entidade, e futuras areas tambem poderao somar pontos no mesmo perfil.

A hierarquia e configurada no Firestore pela colecao `hierarchyRoles`. O bot cria uma configuracao inicial automaticamente, mas os cargos e pontos podem ser editados diretamente na base.

O rank base e `Novato`, com cargo `1488092923588247563` e 0 pontos. `Delusions` comeca em 1 ponto, entao o recrutador sobe para `Delusions` automaticamente ao fazer o primeiro recrutamento aprovado.

Campos de cada documento:

- `guildId`: ID do servidor.
- `name`: nome do rank.
- `roleId`: ID do cargo no Discord.
- `points`: pontos minimos para atingir o rank.
- `order`: ordem do rank, usada como desempate e organizacao.

O criterio de subida e somente pontos. O campo `recruitments` continua no perfil do membro apenas como estatistica.

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
- `panels`
- `panelJobs`
- `supportCategories` (categorias de ticket; escrita so pela `dragons-platform`)
- `tickets` (tickets de suporte abertos; escrita so pelo bot)
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
- `recruitment.created`
- `recruitment.approval_dm_sent`
- `recruitment.approved`
- `recruitment.blocked`
- `recruitment.approval_blocked`
- `config.role_set`
- `config.channel_set`
- `config.number_set`
- `points.viewed`
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
- `panel.layout_reposted` (layout mudou; mensagem antiga apagada e repostada)
- `ticket.opened` / `ticket.open_denied` / `ticket.open_failed`
- `ticket.claimed` / `ticket.closed`
- `ticket.opener_add_failed` / `ticket.ping_edit_failed`
- `interaction.select.received` / `interaction.select.completed`
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
- confirmar que `/recrutar` para membro verificado dentro da janela de credito (default 24h) gera pedido de credito
- confirmar que segundo pedido de credito para o mesmo membro e bloqueado
- usar `/pontos` e confirmar a pontuacao atual
- usar `/ranking` e confirmar a ordenacao por pontos/recrutamentos
- tentar aprovar sem cargo Founder e confirmar bloqueio
- aprovar com Founder e confirmar cargo de membro + os pontos configurados (default 8)
- tentar aprovar novamente e confirmar que nao duplica pontos
