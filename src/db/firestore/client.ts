import { Firestore } from "@google-cloud/firestore";

import type { Environment } from "../../lib/config/env";

const clients = new Map<string, Firestore>();

export function getFirestoreClient(
  environment: Pick<
    Environment,
    | "FIREBASE_PROJECT_ID"
    | "FIRESTORE_DATABASE_ID"
    | "FIRESTORE_EMULATOR_HOST"
  >,
): Firestore {
  if (environment.FIREBASE_PROJECT_ID === undefined) {
    throw new Error("Firestore 프로젝트 설정이 없습니다.");
  }

  const cacheKey = `${environment.FIREBASE_PROJECT_ID}/${environment.FIRESTORE_DATABASE_ID}/${environment.FIRESTORE_EMULATOR_HOST ?? "production"}`;
  const existing = clients.get(cacheKey);
  if (existing) {
    return existing;
  }

  const client = new Firestore({
    projectId: environment.FIREBASE_PROJECT_ID,
    databaseId: environment.FIRESTORE_DATABASE_ID,
    ignoreUndefinedProperties: false,
  });
  clients.set(cacheKey, client);
  return client;
}
