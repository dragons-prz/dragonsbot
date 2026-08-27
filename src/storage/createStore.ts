import { AppEnv } from "../config/env";
import { DragonsStore } from "./DragonsStore";
import { FirestoreDragonsStore } from "./firestore/FirestoreDragonsStore";
import { instrumentStore } from "./instrumentedStore";

export function createStore(env: AppEnv): DragonsStore {
  return instrumentStore(new FirestoreDragonsStore(env));
}
