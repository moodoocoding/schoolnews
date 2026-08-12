import "server-only";

import type { Environment } from "../../lib/config/env";
import { FirestorePublishedPostRepository } from "../../repositories/firestore-published-post.repository";
import { getFirestoreClient } from "./client";
import { GoogleCloudFirestorePublishedPostDataSource } from "./published-post.data-source";

export function createConfiguredFirestorePublishedPostRepository(
  environment: Environment,
): FirestorePublishedPostRepository {
  const firestore = getFirestoreClient(environment);
  return new FirestorePublishedPostRepository(
    new GoogleCloudFirestorePublishedPostDataSource(firestore),
  );
}
