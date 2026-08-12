import "server-only";

import type { Environment } from "../../lib/config/env";
import { DailyRunStoreError } from "../../pipeline/orchestrator/daily-run-store";
import { SupabaseDailyRunRepository } from "../../repositories/supabase-daily-run.repository";
import { createSupabaseDailyRunRpcDataSource } from "./daily-run.data-source";

export function createConfiguredSupabaseDailyRunRepository(
  environment: Environment,
): SupabaseDailyRunRepository {
  if (
    environment.DATASTORE_PROVIDER !== "supabase" ||
    environment.SUPABASE_URL === undefined ||
    environment.SUPABASE_SECRET_KEY === undefined
  ) {
    throw new DailyRunStoreError("STORE_UNAVAILABLE");
  }

  return new SupabaseDailyRunRepository(
    createSupabaseDailyRunRpcDataSource({
      projectUrl: environment.SUPABASE_URL,
      secretKey: environment.SUPABASE_SECRET_KEY,
    }),
  );
}
