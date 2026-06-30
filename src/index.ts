import {
  Client,
  Collection,
  Events,
  GatewayIntentBits
} from "discord.js";
import { loadEnv } from "./config/env";
import { buttonHandlers, commands } from "./commands";
import { SlashCommand } from "./commands/types";
import { createStore } from "./storage/createStore";
import { safeReply } from "./utils/discord";

async function main(): Promise<void> {
  const env = loadEnv();
  const store = createStore(env);
  await store.init();

  const commandMap = new Collection<string, SlashCommand>();
  for (const command of commands) {
    commandMap.set(command.data.name, command);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Dragons online como ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) {
          await interaction.reply({ content: "Comando nao encontrado.", ephemeral: true });
          return;
        }

        await command.execute(interaction, { store });
        return;
      }

      if (interaction.isButton()) {
        const handler = buttonHandlers.find((item) => interaction.customId.startsWith(item.customIdPrefix));
        if (!handler) {
          await interaction.reply({ content: "Acao nao reconhecida.", ephemeral: true });
          return;
        }

        await handler.execute(interaction, { store });
      }
    } catch (error) {
      console.error("Erro ao processar interacao:", error);
      if (interaction.isRepliable()) {
        await safeReply(interaction, "Ocorreu um erro ao processar esta acao.");
      }
    }
  });

  const shutdown = async () => {
    console.log("Encerrando Dragons...");
    client.destroy();
    await store.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await client.login(env.discordToken);
}

main().catch((error) => {
  console.error("Falha ao iniciar o bot:", error);
  process.exit(1);
});
