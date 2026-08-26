import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags
} from "discord.js";
import { loadEnv } from "./config/env";
import { buttonHandlers, commands } from "./commands";
import { announceMemberExit, announceNewMember, startMemberActionJobWorker } from "./commands/recrutar";
import { SlashCommand } from "./commands/types";
import { createStore } from "./storage/createStore";
import { safeReply } from "./utils/discord";
import { logger } from "./utils/logger";

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
  let stopMemberActionJobWorker: () => void = () => undefined;

  client.once(Events.ClientReady, (readyClient) => {
    logger.info("bot.ready", {
      userId: readyClient.user.id,
      tag: readyClient.user.tag
    });
    stopMemberActionJobWorker = startMemberActionJobWorker(client, store);
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      await announceNewMember(member, store);
    } catch (error) {
      logger.error("member_entry.announcement_failed", error, {
        guildId: member.guild.id,
        userId: member.id,
        userTag: member.user.tag
      });
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      await announceMemberExit(member, store);
    } catch (error) {
      logger.error("member_exit.announcement_failed", error, {
        guildId: member.guild.id,
        userId: member.id,
        userTag: member.user.tag
      });
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    const startedAt = Date.now();
    try {
      if (interaction.isChatInputCommand()) {
        logger.info("interaction.command.received", {
          commandName: interaction.commandName,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          userTag: interaction.user.tag
        });

        const command = commandMap.get(interaction.commandName);
        if (!command) {
          await interaction.reply({ content: "Comando nao encontrado.", flags: MessageFlags.Ephemeral });
          logger.warn("interaction.command.unknown", {
            commandName: interaction.commandName,
            interactionId: interaction.id,
            userId: interaction.user.id
          });
          return;
        }

        await command.execute(interaction, { store });
        logger.info("interaction.command.completed", {
          commandName: interaction.commandName,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          durationMs: Date.now() - startedAt
        });
        return;
      }

      if (interaction.isButton()) {
        logger.info("interaction.button.received", {
          customId: interaction.customId,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
          userTag: interaction.user.tag
        });

        const handler = buttonHandlers.find((item) => interaction.customId.startsWith(item.customIdPrefix));
        if (!handler) {
          await interaction.reply({ content: "Acao nao reconhecida.", flags: MessageFlags.Ephemeral });
          logger.warn("interaction.button.unknown", {
            customId: interaction.customId,
            interactionId: interaction.id,
            userId: interaction.user.id
          });
          return;
        }

        await handler.execute(interaction, { store });
        logger.info("interaction.button.completed", {
          customId: interaction.customId,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          durationMs: Date.now() - startedAt
        });
      }
    } catch (error) {
      logger.error("interaction.failed", error, {
        interactionId: interaction.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        isCommand: interaction.isChatInputCommand(),
        commandName: interaction.isChatInputCommand() ? interaction.commandName : undefined,
        isButton: interaction.isButton(),
        customId: interaction.isButton() ? interaction.customId : undefined,
        durationMs: Date.now() - startedAt
      });
      if (interaction.isRepliable()) {
        await safeReply(interaction, "Ocorreu um erro ao processar esta acao.");
      }
    }
  });

  const shutdown = async () => {
    logger.info("bot.shutdown");
    stopMemberActionJobWorker();
    client.destroy();
    await store.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await client.login(env.discordToken);
}

main().catch((error) => {
  logger.error("bot.start_failed", error);
  process.exit(1);
});
