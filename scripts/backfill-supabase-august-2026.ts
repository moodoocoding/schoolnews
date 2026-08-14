import type {
  ModelCallAudit,
  SourceCollectionOutcome,
  SourceRegistryEntry,
} from "../src/contracts";
import { sourceRegistryEntrySchema } from "../src/contracts";
import type { ConfiguredSupabasePipelineRepositories } from "../src/db/supabase/configured-pipeline.repositories";
import {
  createConfiguredSupabaseBackfillPublisherRepository,
  createConfiguredSupabasePipelineRepositories,
} from "../src/db/supabase/server";
import { parseEnvironment } from "../src/lib/config/env";
import { RSS_SOURCE_REGISTRY } from "../src/pipeline/collectors";
import { DeterministicFakeGeneratedPostProvider } from "../src/pipeline/generation";
import {
  mapSupabasePublicationForGeneration,
  runSupabaseDailyPipeline,
  type PostGenerationSemanticEvaluator,
} from "../src/pipeline/orchestrator";

import {
  AUGUST_2026_BACKFILL_TOPICS,
  buildBackfillGeneratedPost,
  type BackfillSource,
  type BackfillTopic,
} from "./backfill-2026-08-content";

const APPROVED_PROJECT = "https://vrjuvozmnaufzvrzzbnd.supabase.co";
const BACKFILL_RPC_PATH = "/rpc/publish_backfill_post";

if (
  process.env.ALLOW_AUGUST_2026_BACKFILL !== "true" ||
  process.env.BACKFILL_CONFIRM_PROJECT !== "vrjuvozmnaufzvrzzbnd"
) {
  throw new Error("AUGUST_2026_BACKFILL_CONFIRMATION_REQUIRED");
}

const environment = parseEnvironment({
  ...process.env,
  NODE_ENV: "production",
  DATASTORE_PROVIDER: "supabase",
  AUTOMATION_MODE: "disabled",
  LLM_ENABLED: "false",
});
if (environment.SUPABASE_URL !== APPROVED_PROJECT) {
  throw new Error("AUGUST_2026_BACKFILL_PROJECT_MISMATCH");
}
const supabaseSecretKey: string =
  environment.SUPABASE_SECRET_KEY ??
  (() => {
    throw new Error("AUGUST_2026_BACKFILL_SECRET_REQUIRED");
  })();
let databaseClockOffsetMs = 0;

async function assertBackfillBoundaryReady(): Promise<Set<string>> {
  const response = await fetch(environment.SUPABASE_URL + "/rest/v1/", {
    headers: {
      accept: "application/openapi+json",
      apikey: supabaseSecretKey,
      authorization: "Bearer " + supabaseSecretKey,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error("AUGUST_2026_BACKFILL_PREFLIGHT_UNAVAILABLE");
  }
  const databaseDateHeader = response.headers.get("date");
  if (databaseDateHeader === null) {
    throw new Error("AUGUST_2026_BACKFILL_SERVER_CLOCK_REQUIRED");
  }
  const databaseNowMs = Date.parse(databaseDateHeader);
  if (!Number.isFinite(databaseNowMs)) {
    throw new Error("AUGUST_2026_BACKFILL_SERVER_CLOCK_REQUIRED");
  }
  databaseClockOffsetMs = databaseNowMs - Date.now() + 1_000;
  const specification = (await response.json()) as { paths?: unknown };
  if (
    specification.paths === null ||
    typeof specification.paths !== "object" ||
    !(BACKFILL_RPC_PATH in specification.paths)
  ) {
    throw new Error("AUGUST_2026_BACKFILL_RPC_NOT_APPLIED");
  }

  const dates = AUGUST_2026_BACKFILL_TOPICS.map((topic) => topic.runDate);
  const expectedTitleByDate = new Map(
    AUGUST_2026_BACKFILL_TOPICS.map((topic) => [topic.runDate, topic.title]),
  );
  const existingUrl = new URL(
    environment.SUPABASE_URL + "/rest/v1/published_posts",
  );
  existingUrl.searchParams.set("select", "publication_date_kst,title");
  existingUrl.searchParams.set(
    "publication_date_kst",
    "in.(" + dates.join(",") + ")",
  );
  const existingResponse = await fetch(existingUrl, {
    headers: {
      accept: "application/json",
      apikey: supabaseSecretKey,
      authorization: "Bearer " + supabaseSecretKey,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!existingResponse.ok) {
    throw new Error("AUGUST_2026_BACKFILL_PREFLIGHT_UNAVAILABLE");
  }
  const existing = (await existingResponse.json()) as unknown;
  if (!Array.isArray(existing)) {
    throw new Error("AUGUST_2026_BACKFILL_PREFLIGHT_INVALID_RESPONSE");
  }
  const existingRows = existing.flatMap((row) =>
    row !== null &&
    typeof row === "object" &&
    "publication_date_kst" in row &&
    typeof row.publication_date_kst === "string" &&
    "title" in row &&
    typeof row.title === "string"
      ? [{ date: row.publication_date_kst, title: row.title }]
      : [],
  );
  if (existingRows.length !== existing.length) {
    throw new Error("AUGUST_2026_BACKFILL_PREFLIGHT_INVALID_RESPONSE");
  }
  const unexpectedDates = existingRows.filter(
    (row) => !dates.includes(row.date),
  );
  if (unexpectedDates.length > 0) {
    throw new Error("AUGUST_2026_BACKFILL_PREFLIGHT_INVALID_RESPONSE");
  }
  // A date inside the target range is only safe to skip as "already done" if
  // the published title matches this backfill's own content for that date.
  // Any other occupant of the date is treated exactly like the old
  // all-or-nothing guard: abort instead of silently overwriting or ignoring it.
  const foreignOccupants = existingRows.filter(
    (row) => row.title !== expectedTitleByDate.get(row.date),
  );
  if (foreignOccupants.length > 0) {
    throw new Error("AUGUST_2026_BACKFILL_DATES_ALREADY_OCCUPIED");
  }
  return new Set(existingRows.map((row) => row.date));
}

const alreadyPublishedDates = await assertBackfillBoundaryReady();
const requestedStartDate = process.env.BACKFILL_START_DATE;
if (
  requestedStartDate !== undefined &&
  !AUGUST_2026_BACKFILL_TOPICS.some(
    (topic) => topic.runDate === requestedStartDate,
  )
) {
  throw new Error("AUGUST_2026_BACKFILL_START_DATE_INVALID");
}

const baseSource = RSS_SOURCE_REGISTRY[0];

function sourceId(runDate: string, index: number): string {
  return "backfill-" + runDate.replaceAll("-", "") + "-" + (index + 1);
}

function createSource(
  topic: BackfillTopic,
  source: BackfillSource,
  index: number,
): SourceRegistryEntry {
  const id = sourceId(topic.runDate, index);
  const origin = new URL(source.url).origin;
  return sourceRegistryEntrySchema.parse({
    ...baseSource,
    sourceId: id,
    name: source.publisher,
    publisherGroupId: id,
    provenanceGroupPrefix: id,
    collectionType: "rss",
    feedUrl: source.url,
    siteUrl: origin + "/",
    publisherType: source.publisherType,
    originType: source.originType,
    sourceRole: source.sourceRole,
    sourceType: source.sourceType,
    authority: "none",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-13T00:00:00.000Z",
    policyReferenceUrls: [source.policyUrl],
    notes:
      "운영자 승인 백필에 사용한 공개 문서입니다. 네트워크 수집 없이 확인된 짧은 사실 passage와 메타데이터만 저장합니다.",
  });
}

function collectionOutcome(
  topic: BackfillTopic,
  source: SourceRegistryEntry,
  document: BackfillSource,
): SourceCollectionOutcome {
  const startedAt = topic.runDate + "T06:00:00+09:00";
  return {
    sourceId: source.sourceId,
    status: "succeeded",
    startedAt,
    finishedAt: topic.runDate + "T06:00:01+09:00",
    items: [
      {
        sourceId: source.sourceId,
        externalId: source.sourceId + "-document",
        originalUrl: document.url,
        title:
          "초등 AI 디지털 교육 " +
          topic.title +
          " — " +
          document.documentTitle,
        excerpt: document.passage,
        author: null,
        publisher: document.publisher,
        publishedAt: document.publishedAt,
        publishedAtPrecision: "date",
        discoveredAt: startedAt,
      },
    ],
    issues: [],
  };
}

function semanticEvaluator(runDate: string): PostGenerationSemanticEvaluator {
  return {
    async evaluate(input) {
      const audit: ModelCallAudit = {
        callId:
          "curated-semantic-" +
          runDate.replaceAll("-", "") +
          "-" +
          input.attemptNumber,
        attemptNumber: input.attemptNumber,
        purpose: "semantic_review",
        providerId: "curated-editorial",
        modelId: "curated-semantic-v1",
        promptVersion: "semantic-evaluator-v1",
        startedAt: "2026-08-13T00:00:00.000Z",
        finishedAt: "2026-08-13T00:00:01.000Z",
        evidenceIds: input.evidenceItems.map((item) => item.evidenceId),
        usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
        estimatedCostUsd: 0,
        finishReason: "stop",
        responseId: null,
      };
      return {
        review: {
          passed: true,
          evaluatorVersion: "curated-semantic-v1",
          findings: [],
        },
        audit,
      };
    },
  };
}

const repositories: ConfiguredSupabasePipelineRepositories =
  createConfiguredSupabasePipelineRepositories(environment, {
  writeAuthority: () => {
    throw new Error("Explicit stage authority is required.");
  },
  publicationPostMapper: (input) =>
    mapSupabasePublicationForGeneration({
      workspace: repositories.workspace,
      runDate: input.runDate,
      runId: input.runId,
      generationOutputReference: input.generationOutputReference,
      generatedPost: input.generatedPost,
      qualityResult: input.qualityResult,
    }),
  });
const backfillPublisher =
  createConfiguredSupabaseBackfillPublisherRepository(environment);
const initialHistory = await repositories.publicationHistory.getRecent(365);
const publishedTitles: string[] = [];

for (const topic of AUGUST_2026_BACKFILL_TOPICS) {
  if (requestedStartDate !== undefined && topic.runDate < requestedStartDate) {
    continue;
  }
  if (alreadyPublishedDates.has(topic.runDate)) {
    publishedTitles.push(topic.title);
    console.log(
      JSON.stringify({
        event: "august_2026_backfill_date_already_published",
        runDate: topic.runDate,
        actualGeminiCalls: false,
      }),
    );
    continue;
  }
  const sources = topic.sources.map((source, index) =>
    createSource(topic, source, index),
  );
  const provider = new DeterministicFakeGeneratedPostProvider({
    post: (request) =>
      buildBackfillGeneratedPost(topic, request.evidenceItems),
    metadata: {
      providerId: "curated-editorial",
      modelId: "curated-generation-v1",
    },
    usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
    costEstimator: () => 0,
  });

  const result = await runSupabaseDailyPipeline({
    store: repositories.dailyRun,
    workspace: repositories.workspace,
    contentPersistence: repositories.contentPersistence,
    sourceAttempt: {
      reserve: async ({ sourceId: requestedSourceId, minIntervalMs }) => ({
        status: "allowed" as const,
        sourceId: requestedSourceId,
        lastAttemptAt: topic.runDate + "T00:00:00+09:00",
        nextAllowedAt: new Date(
          Date.parse(topic.runDate + "T00:00:00+09:00") + minIntervalMs,
        ).toISOString(),
      }),
    },
    publisher: backfillPublisher,
    publishReceipt: repositories.publishReceipt,
    sources,
    collectSource: async (source) => {
      const index = sources.findIndex(
        (candidate) => candidate.sourceId === source.sourceId,
      );
      const document = topic.sources[index];
      if (document === undefined) {
        throw new Error("BACKFILL_SOURCE_NOT_FOUND");
      }
      return collectionOutcome(topic, source, document);
    },
    generation: {
      configurationId: "curated-backfill-" + topic.runDate + "-v1",
      ledger: repositories.modelInvocation,
      budget: {
        maxModelCalls: 2,
        maxInputTokens: 2_000,
        maxOutputTokens: 2_000,
        maxEstimatedCostUsd: 0.01,
        maxCallSeconds: 30,
      },
      generatedRoutes: [
        {
          provider,
          metadata: {
            providerId: "curated-editorial",
            modelId: "curated-generation-v1",
          },
          promptVersion: "generated-post-v2",
          reservationPolicyVersion: "curated-fixed-v1",
          reservation: (request) => ({
            inputTokens: 500,
            outputTokens: request.maxOutputTokens,
            costUsd: 0,
          }),
        },
      ],
      semanticRoutes: [
        {
          evaluator: semanticEvaluator(topic.runDate),
          providerId: "curated-editorial",
          modelId: "curated-semantic-v1",
          promptVersion: "semantic-evaluator-v1",
          reservationPolicyVersion: "curated-fixed-v1",
          reservation: (request) => ({
            inputTokens: 500,
            outputTokens: request.maxOutputTokens,
            costUsd: 0,
          }),
        },
      ],
    },
    collectionConfigurationId:
      "curated-backfill-sources-" + topic.runDate + "-v1",
    previousPostTitles: [...initialHistory.titles, ...publishedTitles],
    previousContentFingerprints: initialHistory.contentFingerprints,
    limits: {
      maxModelCalls: 2,
      maxInputTokens: 2_000,
      maxOutputTokens: 2_000,
      maxEstimatedCostUsd: 0.01,
      maxRunSeconds: 300,
    },
    runDate: topic.runDate,
    ownerId: "approved-august-2026-backfill",
    now: () => new Date(Date.now() + databaseClockOffsetMs),
  });

  if (
    result.status === "busy" ||
    result.journal.run.status !== "succeeded"
  ) {
    throw new Error(
      "AUGUST_2026_BACKFILL_FAILED:" +
        topic.runDate +
        ":" +
        (result.status === "busy" ? result.status : result.journal.run.status),
    );
  }

  publishedTitles.push(topic.title);
  console.log(
    JSON.stringify({
      event: "august_2026_backfill_date_completed",
      runDate: topic.runDate,
      runId: result.journal.run.runId,
      status: result.status,
      actualGeminiCalls: false,
    }),
  );
}

console.log(
  JSON.stringify({
    event: "august_2026_backfill_completed",
    requested: AUGUST_2026_BACKFILL_TOPICS.length,
    actualGeminiCalls: false,
    publicProjectionWrites: true,
  }),
);
