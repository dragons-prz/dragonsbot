import "dotenv/config";

export type DatabaseProvider = "sqlite";

export interface AppEnv {
  discordClientId: string;
  discordToken: string;
  discordGuildId?: string;
  databaseProvider: DatabaseProvider;
  sqlitePath: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }

  return value;
}

export function loadEnv(): AppEnv {
  const provider = process.env.DATABASE_PROVIDER ?? "sqlite";
  if (provider !== "sqlite") {
    throw new Error(`DATABASE_PROVIDER nao suportado: ${provider}`);
  }

  return {
    discordClientId: required("DISCORD_CLIENT_ID"),
    discordToken: required("DISCORD_TOKEN"),
    discordGuildId: process.env.DISCORD_GUILD_ID || undefined,
    databaseProvider: provider,
    sqlitePath: process.env.SQLITE_PATH ?? "./data/dragons.sqlite"
  };
}
