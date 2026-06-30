import { REST, Routes } from "discord.js";
import { commands } from "./commands";
import { loadEnv } from "./config/env";

async function main(): Promise<void> {
  const env = loadEnv();
  const rest = new REST({ version: "10" }).setToken(env.discordToken);
  const body = commands.map((command) => command.data.toJSON());

  if (env.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId), { body });
    console.log(`Comandos registrados no servidor ${env.discordGuildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(env.discordClientId), { body });
  console.log("Comandos globais registrados. Pode levar alguns minutos para aparecerem.");
}

main().catch((error) => {
  console.error("Falha ao registrar comandos:", error);
  process.exit(1);
});
