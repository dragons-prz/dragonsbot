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
- member: `1487825181337587822`

### `/config set-channel tipo:approval channel:<canal>`

Configura um canal de aprovacao legado. Apenas administradores podem usar.

```text
/config set-channel tipo:approval channel:#canal-de-aprovacoes
```

O fluxo atual envia a aprovacao por DM para todos os membros com cargo `founder`, entao este canal nao e obrigatorio para recrutar.

### `/config show`

Mostra a configuracao atual de cargos e canal do servidor. Apenas administradores podem usar.

### `/recrutar usuario:<membro>`

Cria uma ficha de recrutamento pendente.

Regras:

- quem usa o comando precisa ter o cargo `recruiter`
- o usuario precisa estar no servidor
- o usuario nao pode ja ter o cargo `member`
- nao pode existir outro recrutamento pendente para o mesmo usuario
- precisa existir pelo menos um Founder com DM aberta para receber a aprovacao

Quando criado com sucesso, o bot envia uma DM para todos os Founders com:

- mencao do usuario recrutado
- ID do usuario em formato copiavel
- recrutador
- instrucao para adicionar o usuario na familia do servidor da Pureza
- botao `Adicionei na familia`

### `/pontos`

Mostra sua pontuacao atual e a quantidade de recrutamentos aprovados feitos por voce. A resposta e privada.

### `/ranking limite:<numero>`

Mostra o ranking de membros do servidor, ordenado por pontos e depois por recrutamentos aprovados. O limite e opcional, com padrao 10 e maximo 25.

## Aprovacao

O botao `Adicionei na familia` so pode ser usado por membros com o cargo `founder`.

Ao aprovar:

- o recrutamento muda para `approved`
- o usuario recrutado recebe o cargo `member`
- o recrutador recebe 8 pontos
- os pontos entram no perfil generico de membro
- se o recrutador atingir a pontuacao de um novo rank, o cargo de hierarquia e atualizado automaticamente
- quando houver promocao, o recrutador recebe uma DM informando o novo cargo
- as DMs enviadas aos Founders sao atualizadas para mostrar a aprovacao
- o botao e desativado para evitar pontos duplicados

## Hierarquia

A pontuacao fica na entidade generica de membro, nao em uma entidade exclusiva de recrutador. Hoje recrutamento soma pontos nessa entidade, e futuras areas tambem poderao somar pontos no mesmo perfil.

Ranks configurados:

| Cargo | ID do Cargo | Pontos | Recrutamentos |
| --- | --- | ---: | ---: |
| Delusions | `1487888136598982838` | 0 | 0 |
| Hope | `1488087958249799850` | 24 | 3 |
| Lotus | `1488086603980214433` | 56 | 7 |
| Swag | `1488087908480057354` | 96 | 12 |
| Revenge | `1488086779532939284` | 144 | 18 |
| Mystic | `1488086653359882271` | 200 | 25 |
| Darkness | `1488086711278764213` | 264 | 33 |
| Death | `1487888101245325552` | 336 | 42 |
| Nightmare | `1487888057901518849` | 416 | 52 |
| Critic | `1487887943103283240` | 504 | 63 |
| Prince Of Chaos | `1487888006345003058` | 600 | 75 |
| Legend | `1488088043133865994` | 704 | 88 |
| Supreme | `1488088157625909269` | 816 | 102 |
| Insanity | `1488088110599503903` | 936 | 117 |
| Royal | `1487887769182142514` | 1064 | 133 |
| Imperial | `1487887706015928455` | 1200 | 150 |
| Destiny | `1487884344872927365` | 1360 | 170 |
| Eternal | `1488088203436097566` | 1536 | 192 |
| Immortal | `1487887891676926032` | 1728 | 216 |
| Angelical | `1487887828523417611` | 1920 | 240 |
| God | `1488086504202043502` | 2160 | 270 |

## Banco de dados

O bot usa Firebase Firestore. A interface `DragonsStore` foi mantida para permitir trocar de banco futuramente sem alterar os comandos.

Colecoes usadas no Firestore:

- `guildConfigs`
- `recruitments`
- `members`
- `memberPointEvents`
- `counters`
- subcolecao `recruitments/{id}/approvalMessages`

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
- `points.viewed`
- `ranking.viewed`

## Validacao

```bash
npm run build
```

Checklist manual recomendado:

- configurar cargos com `/config`
- tentar recrutar sem cargo de recrutador e confirmar bloqueio
- recrutar com cargo correto e confirmar DM para Founders
- usar `/pontos` e confirmar a pontuacao atual
- usar `/ranking` e confirmar a ordenacao por pontos/recrutamentos
- tentar aprovar sem cargo Founder e confirmar bloqueio
- aprovar com Founder e confirmar cargo de membro + 8 pontos
- tentar aprovar novamente e confirmar que nao duplica pontos
