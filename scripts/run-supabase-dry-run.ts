import { parseEnvironment } from "../src/lib/config/env";
import {
  createConfiguredSupabaseContentPersistenceRepository,
  createConfiguredSupabaseDailyRunRepository,
  createConfiguredSupabasePipelineWorkspaceRepository,
  createConfiguredSupabasePublicationHistoryRepository,
} from "../src/db/supabase/server";
import { collectRssSource, RSS_SOURCE_REGISTRY } from "../src/pipeline/collectors";
import { runSupabaseDailyPipeline } from "../src/pipeline/orchestrator";

const runDateKst = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

if (
  process.env.ALLOW_SUPABASE_DRY_RUN !== "true" ||
  process.env.SUPABASE_DRY_RUN_CONFIRM_DATE !== runDateKst
) {
  throw new Error("SUPABASE_DRY_RUN_CONFIRMATION_REQUIRED");
}

const environment = parseEnvironment({
  ...process.env,
  NODE_ENV: "production",
  DATASTORE_PROVIDER: "supabase",
  AUTOMATION_MODE: "dry_run",
  LLM_ENABLED: "false",
});

if (
  environment.SUPABASE_URL === "https://vrjuvozmnaufzvrzzbnd.supabase.co" &&
  process.env.ALLOW_PRODUCTION_SUPABASE_DRY_RUN !== "true"
) {
  throw new Error("PRODUCTION_SUPABASE_DRY_RUN_NOT_CONFIRMED");
}

const dailyRun = createConfiguredSupabaseDailyRunRepository(environment);
const contentPersistence =
  createConfiguredSupabaseContentPersistenceRepository(environment);
const historyRepository =
  createConfiguredSupabasePublicationHistoryRepository(environment);
const workspace = createConfiguredSupabasePipelineWorkspaceRepository(environment, {
  writeAuthority: () => {
    throw new Error("Explicit stage authority is required.");
  },
  publicationPostMapper: () => {
    throw new Error("Dry-run must not create a publication artifact.");
  },
});
const history = await historyRepository.getRecent(365);

const result = await runSupabaseDailyPipeline({
  executionMode: "dry_run",
  store: dailyRun,
  workspace,
  contentPersistence,
  sources: RSS_SOURCE_REGISTRY,
  collectSource: (source, signal) => collectRssSource(source, { signal }),
  collectionConfigurationId: "licensed-production-sources-v2",
  previousPostTitles: history.titles,
  previousContentFingerprints: history.contentFingerprints,
  limits: {
    maxModelCalls: 0,
    maxInputTokens: 0,
    maxOutputTokens: 0,
    maxEstimatedCostUsd: 0,
    maxRunSeconds: 180,
  },
  ownerId: "manual-supabase-dry-run",
});

if (result.status === "busy") {
  console.log(
    JSON.stringify({
      event: "supabase_dry_run_busy",
      runId: result.runId,
      externalNewsCollection: true,
      modelCalls: false,
      publishing: false,
    }),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      event: "supabase_dry_run_completed",
      runId: result.journal.run.runId,
      runDate: result.journal.run.runDate,
      runStatus: result.journal.run.status,
      terminalReason: result.journal.terminalReason,
      externalNewsCollection: true,
      modelCalls: result.journal.run.usage.modelCalls,
      publishing: false,
    }),
  );
  if (["failed", "blocked"].includes(result.journal.run.status)) {
    process.exitCode = 1;
  }
}
