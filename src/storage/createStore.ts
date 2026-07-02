import { AppEnv } from "../config/env";
import { DragonsStore } from "./DragonsStore";
import { FirestoreDragonsStore } from "./firestore/FirestoreDragonsStore";

export function createStore(env: AppEnv): DragonsStore {
  return new FirestoreDragonsStore(env);
}
