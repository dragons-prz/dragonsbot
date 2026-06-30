import { AppEnv } from "../config/env";
import { DragonsStore } from "./DragonsStore";
import { SqliteDragonsStore } from "./sqlite/SqliteDragonsStore";

export function createStore(env: AppEnv): DragonsStore {
  if (env.databaseProvider === "sqlite") {
    return new SqliteDragonsStore(env.sqlitePath);
  }

  throw new Error(`Provider de banco nao suportado: ${env.databaseProvider}`);
}
