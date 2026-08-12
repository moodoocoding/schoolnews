import "server-only";

import type { Environment } from "../../lib/config/env";
import { SupabasePublishedPostRepository } from "../../repositories/supabase-published-post.repository";
import {
  SupabaseDataApiError,
  SupabaseRestPublishedPostDataSource,
} from "./published-post.data-source";

export function createConfiguredSupabasePublishedPostRepository(
  environment: Environment,
): SupabasePublishedPostRepository {
  if (
    environment.DATASTORE_PROVIDER !== "supabase" ||
    environment.SUPABASE_URL === undefined ||
    environment.SUPABASE_PUBLISHABLE_KEY === undefined
  ) {
    throw new SupabaseDataApiError("MISSING_CONFIG");
  }

  return new SupabasePublishedPostRepository(
    new SupabaseRestPublishedPostDataSource({
      projectUrl: environment.SUPABASE_URL,
      publishableKey: environment.SUPABASE_PUBLISHABLE_KEY,
    }),
  );
}
