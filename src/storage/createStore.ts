import { AppEnv } from "../config/env";
import { DragonsStore } from "./DragonsStore";
import { FirestoreDragonsStore } from "./firestore/FirestoreDragonsStore";
import { SqliteDragonsStore } from "./sqlite/SqliteDragonsStore";

export function createStore(env: AppEnv): DragonsStore {
  if (env.databaseProvider === "sqlite") {
    return new SqliteDragonsStore(env.sqlitePath);
  }

  if (env.databaseProvider === "firestore") {
    return new FirestoreDragonsStore(env);
  }

  throw new Error(`Provider de banco nao suportado: ${env.databaseProvider}`);
}
