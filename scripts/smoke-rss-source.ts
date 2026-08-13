import { parseEnvironment } from "../src/lib/config/env";
import { createConfiguredSupabaseSourceAttemptRepository } from "../src/db/supabase/server";
import { collectRssSource, RSS_SOURCE_REGISTRY } from "../src/pipeline/collectors";

const todayKst = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const requestedSourceId = process.env.RSS_SOURCE_SMOKE_ID;

if (
  process.env.ALLOW_RSS_SOURCE_SMOKE !== "true" ||
  process.env.RSS_SOURCE_SMOKE_CONFIRM_DATE !== todayKst ||
  !requestedSourceId
) {
  throw new Error("RSS_SOURCE_SMOKE_CONFIRMATION_REQUIRED");
}

const source = RSS_SOURCE_REGISTRY.find(
  (candidate) => candidate.sourceId === requestedSourceId,
);
if (!source || !source.enabled || source.accessStatus !== "allowed") {
  throw new Error("RSS_SOURCE_SMOKE_SOURCE_NOT_ALLOWED");
}

const environment = parseEnvironment({
  ...process.env,
  NODE_ENV: "production",
  DATASTORE_PROVIDER: "supabase",
  AUTOMATION_MODE: "disabled",
  LLM_ENABLED: "false",
});
const sourceAttempt = createConfiguredSupabaseSourceAttemptRepository(environment);
const reservation = await sourceAttempt.reserve({
  sourceId: source.sourceId,
  minIntervalMs: source.requestPolicy.minIntervalMs,
});

if (reservation.status === "too_soon") {
  console.log(
    JSON.stringify({
      event: "rss_source_smoke_too_soon",
      sourceId: source.sourceId,
      nextAllowedAt: reservation.nextAllowedAt,
      modelCalls: false,
      publishing: false,
    }),
  );
} else {
  const outcome = await collectRssSource(source);
  console.log(
    JSON.stringify({
      event: "rss_source_smoke_completed",
      sourceId: source.sourceId,
      status: outcome.status,
      itemCount: outcome.items.length,
      issueCount: outcome.issues.length,
      modelCalls: false,
      publishing: false,
      contentLogged: false,
    }),
  );
  if (outcome.status === "failed") process.exitCode = 1;
}
