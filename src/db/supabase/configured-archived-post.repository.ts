import "server-only";

import type { Environment } from "../../lib/config/env";
import { SupabaseArchivedPostRepository } from "../../repositories/supabase-archived-post.repository";
import { SupabaseDataApiError } from "./published-post.data-source";
import { SupabaseRestArchivedPostDataSource } from "./archived-post.data-source";

export function createConfiguredSupabaseArchivedPostRepository(
  environment: Environment,
): SupabaseArchivedPostRepository {
  if (
    environment.DATASTORE_PROVIDER !== "supabase" ||
    environment.SUPABASE_URL === undefined ||
    environment.SUPABASE_PUBLISHABLE_KEY === undefined
  ) {
    throw new SupabaseDataApiError("MISSING_CONFIG");
  }

  return new SupabaseArchivedPostRepository(
    new SupabaseRestArchivedPostDataSource({
      projectUrl: environment.SUPABASE_URL,
      publishableKey: environment.SUPABASE_PUBLISHABLE_KEY,
    }),
  );
}

