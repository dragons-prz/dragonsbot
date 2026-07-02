import "dotenv/config";

export interface AppEnv {
  discordClientId: string;
  discordToken: string;
  discordGuildId?: string;
  firebaseServiceAccountPath?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }

  return value;
}

export function loadEnv(): AppEnv {
  return {
    discordClientId: required("DISCORD_CLIENT_ID"),
    discordToken: required("DISCORD_TOKEN"),
    discordGuildId: process.env.DISCORD_GUILD_ID || undefined,
    firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || undefined
  };
}
