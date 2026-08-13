import type {
  EvidenceItem,
  GeneratedPost,
  ModelCallAudit,
  SourceCollectionOutcome,
  SourceRegistryEntry,
} from "../src/contracts";
import { sourceRegistryEntrySchema } from "../src/contracts";
import { parseEnvironment } from "../src/lib/config/env";
import { createConfiguredSupabasePipelineRepositories } from "../src/db/supabase/server";
import { RSS_SOURCE_REGISTRY } from "../src/pipeline/collectors";
import { DeterministicFakeGeneratedPostProvider } from "../src/pipeline/generation";
import {
  mapSupabasePublicationForGeneration,
  runSupabaseDailyPipeline,
  type PostGenerationSemanticEvaluator,
} from "../src/pipeline/orchestrator";
import type { ConfiguredSupabasePipelineRepositories } from "../src/db/supabase/configured-pipeline.repositories";
import { SupabaseContentPersistenceError } from "../src/repositories";
import { z } from "zod";
import {
  evidenceItemSchema,
  identifierSchema,
  normalizedArticleSchema,
  publicationDateKstSchema,
  sha256Schema,
} from "../src/contracts";

if (process.env.ALLOW_TEST_PUBLICATION !== "true") {
  throw new Error("ALLOW_TEST_PUBLICATION_REQUIRED");
}

const runDateKst = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

if (process.env.TEST_PUBLICATION_CONFIRM_DATE !== runDateKst) {
  throw new Error("TEST_PUBLICATION_CONFIRM_DATE_REQUIRED");
}

const environment = parseEnvironment({
  ...process.env,
  NODE_ENV: "production",
  DATASTORE_PROVIDER: "supabase",
  AUTOMATION_MODE: "disabled",
  LLM_ENABLED: "false",
});

if (environment.SUPABASE_URL !== "https://vrjuvozmnaufzvrzzbnd.supabase.co") {
  throw new Error("TEST_PUBLICATION_PROJECT_MISMATCH");
}

const baseSource = RSS_SOURCE_REGISTRY[0];
const testSources: readonly SourceRegistryEntry[] = [
  sourceRegistryEntrySchema.parse({
    ...baseSource,
    sourceId: "development-public-authority",
    name: "개발용 공식 자료",
    publisherGroupId: "development-public-authority",
    provenanceGroupPrefix: "development-primary",
    feedUrl: "https://public-authority.example.invalid/rss.xml",
    siteUrl: "https://public-authority.example.invalid/",
    policyReferenceUrls: ["https://public-authority.example.invalid/policy"],
  }),
  sourceRegistryEntrySchema.parse({
    ...baseSource,
    sourceId: "development-independent-news",
    name: "개발용 독립 보도",
    publisherGroupId: "development-independent-news",
    provenanceGroupPrefix: "development-independent",
    feedUrl: "https://independent-news.example.invalid/rss.xml",
    siteUrl: "https://independent-news.example.invalid/",
    publisherType: "news",
    originType: "original_reporting",
    sourceRole: "independent",
    sourceType: "news",
    authority: "none",
    policyReferenceUrls: ["https://independent-news.example.invalid/policy"],
  }),
];

function collectionOutcome(source: SourceRegistryEntry): SourceCollectionOutcome {
  const isIndependent = source.sourceRole === "independent";
  return {
    sourceId: source.sourceId,
    status: "succeeded",
    startedAt: "2026-08-13T06:00:00+09:00",
    finishedAt: "2026-08-13T06:00:01+09:00",
    items: [
      {
        sourceId: source.sourceId,
        externalId: `${source.sourceId}-fixture-${runDateKst.replaceAll("-", "")}`,
        originalUrl: `${source.siteUrl}development-fixture`,
        title: "[개발용 자료] 초등 AI 수업 개인정보 확인",
        excerpt: isIndependent
          ? "개발용 독립 자료는 초등 AI 수업 전에 개인정보 수집 항목과 보관 기간을 확인하라고 설명합니다. 이 문장은 실제 기사가 아닌 개발 테스트용 근거입니다."
          : "개발용 공식 자료는 초등 AI 수업 전에 개인정보 수집 목적과 안전 설정을 확인하라고 설명합니다. 이 문장은 실제 기사가 아닌 개발 테스트용 근거입니다.",
        author: null,
        publisher: source.name,
        publishedAt: `${runDateKst}T00:00:00+09:00`,
        publishedAtPrecision: "date",
        discoveredAt: `${runDateKst}T06:00:00+09:00`,
      },
    ],
    issues: [],
  };
}

function generatedPost(items: readonly EvidenceItem[]): GeneratedPost {
  const [primary, independent] = items;
  const summary =
    "개발용 두 자료는 초등 AI 수업 전 개인정보와 안전 설정 확인을 설명합니다.";
  return {
    title: "[개발용 테스트] 초등 AI 수업 확인",
    oneLineSummary: {
      sentenceId: "summary-sentence",
      text: summary,
      claimIds: ["summary-claim"],
    },
    body: [
      {
        sentences: [
          {
            sentenceId: "primary-sentence",
            text: primary.passage,
            claimIds: ["primary-claim"],
          },
        ],
      },
      {
        sentences: [
          {
            sentenceId: "independent-sentence",
            text: independent.passage,
            claimIds: ["independent-claim"],
          },
        ],
      },
      {
        sentences: [
          {
            sentenceId: "context-sentence",
            text: "두 개발용 자료는 수업 전 확인 항목을 함께 설명합니다.",
            claimIds: ["context-claim"],
          },
        ],
      },
    ],
    questions: ["우리 학급은 AI 수업 전에 어떤 설정을 확인해야 할까요?"],
    claims: [
      {
        claimId: "summary-claim",
        text: summary,
        kind: "context",
        importance: "key",
        displayCitation: true,
        evidenceRefs: items.map((item) => ({
          evidenceId: item.evidenceId,
          support: "direct" as const,
        })),
      },
      {
        claimId: "primary-claim",
        text: primary.passage,
        kind: "fact",
        importance: "key",
        displayCitation: true,
        evidenceRefs: [{ evidenceId: primary.evidenceId, support: "direct" }],
      },
      {
        claimId: "independent-claim",
        text: independent.passage,
        kind: "fact",
        importance: "key",
        displayCitation: true,
        evidenceRefs: [
          { evidenceId: independent.evidenceId, support: "direct" },
        ],
      },
      {
        claimId: "context-claim",
        text: "두 개발용 자료는 수업 전 확인 항목을 함께 설명한다.",
        kind: "context",
        importance: "supporting",
        displayCitation: false,
        evidenceRefs: items.map((item) => ({
          evidenceId: item.evidenceId,
          support: "context" as const,
        })),
      },
    ],
    usedEvidenceIds: items.map((item) => item.evidenceId),
  };
}

const semanticEvaluator: PostGenerationSemanticEvaluator = {
  async evaluate(input) {
    const audit: ModelCallAudit = {
      callId: `fixture-semantic-${input.attemptNumber}`,
      attemptNumber: input.attemptNumber,
      purpose: "semantic_review",
      providerId: "development-fixture",
      modelId: "development-semantic-v1",
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
        evaluatorVersion: "development-semantic-v1",
        findings: [],
      },
      audit,
    };
  },
};

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

const history = await repositories.publicationHistory.getRecent(365);
const provider = new DeterministicFakeGeneratedPostProvider({
  post: (request) => generatedPost(request.evidenceItems),
  metadata: {
    providerId: "development-fixture",
    modelId: "development-generation-v1",
  },
  usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
  costEstimator: () => 0,
});
const contentPersistence = {
  persistCollectedContent: async (
    input: Parameters<
      ConfiguredSupabasePipelineRepositories["contentPersistence"]["persistCollectedContent"]
    >[0],
  ) => {
    if (process.env.DEBUG_TEST_PUBLICATION === "true") {
      const shapeCheck = z
        .object({
          runDate: publicationDateKstSchema,
          runId: identifierSchema,
          leaseToken: identifierSchema,
          fence: z.number().int().min(1),
          expectedRevision: z.number().int().min(0),
          sources: z.array(sourceRegistryEntrySchema).min(1),
          articles: z.array(normalizedArticleSchema),
          evidenceItems: z.array(evidenceItemSchema),
          artifact: z
            .object({
              outputReference: z.string().trim().min(1).max(500),
              payloadFingerprint: sha256Schema,
              configurationFingerprint: sha256Schema,
              payload: z.json(),
            })
            .strict(),
        })
        .strict()
        .safeParse(input);
      const articleById = new Map(
        input.articles.map((article) => [article.articleId, article]),
      );
      const sourceById = new Map(
        input.sources.map((source) => [source.sourceId, source]),
      );
      console.error(
        JSON.stringify({
          event: "supabase_test_collect_shape",
          schemaIssues: shapeCheck.success
            ? []
            : shapeCheck.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path.join("."),
              })),
          unique: {
            sources:
              new Set(input.sources.map((item) => item.sourceId)).size ===
              input.sources.length,
            articles:
              new Set(input.articles.map((item) => item.articleId)).size ===
              input.articles.length,
            canonicalUrls:
              new Set(input.articles.map((item) => item.canonicalUrlHash)).size ===
              input.articles.length,
            content:
              new Set(input.articles.map((item) => item.contentFingerprint))
                .size === input.articles.length,
            evidence:
              new Set(input.evidenceItems.map((item) => item.evidenceId)).size ===
              input.evidenceItems.length,
          },
          payloadArticlesMatch:
            JSON.stringify(
              (input.artifact.payload as { value: { articles: unknown } }).value
                .articles,
            ) === JSON.stringify(input.articles),
          payloadEvidenceMatch:
            JSON.stringify(
              (input.artifact.payload as { value: { evidenceItems: unknown } })
                .value.evidenceItems,
            ) === JSON.stringify(input.evidenceItems),
          sources: input.sources.map((source) => ({
            id: source.sourceId,
            enabled: source.enabled,
            access: source.accessStatus,
          })),
          articles: input.articles.map((article) => ({
            source: article.sourceId,
            publisherGroupMatches:
              article.publisherGroupId ===
              sourceById.get(article.sourceId)?.publisherGroupId,
            originMatches:
              article.originType === sourceById.get(article.sourceId)?.originType,
            provenanceMatches: article.provenanceGroupKey.startsWith(
              `${sourceById.get(article.sourceId)?.provenanceGroupPrefix}:`,
            ),
          })),
          evidence: input.evidenceItems.map((evidence) => ({
            source: evidence.sourceId,
            hasArticle: articleById.has(evidence.articleId),
            role: evidence.sourceRole,
            authority: evidence.authority,
            locator: evidence.locator,
            publisherMatches:
              evidence.publisherGroupId ===
              articleById.get(evidence.articleId)?.publisherGroupId,
            provenanceMatches:
              evidence.provenanceGroupKey ===
              articleById.get(evidence.articleId)?.provenanceGroupKey,
            titleMatches:
              evidence.title === articleById.get(evidence.articleId)?.title,
            urlMatches:
              evidence.url === articleById.get(evidence.articleId)?.canonicalUrl,
            nameMatches:
              evidence.sourceName === sourceById.get(evidence.sourceId)?.name,
            roleMatches:
              evidence.sourceRole ===
              sourceById.get(evidence.sourceId)?.sourceRole,
            typeMatches:
              evidence.sourceType ===
              sourceById.get(evidence.sourceId)?.sourceType,
            publishedMatches:
              evidence.publishedAt ===
                articleById.get(evidence.articleId)?.publishedAt &&
              evidence.publishedAtPrecision ===
                articleById.get(evidence.articleId)?.publishedAtPrecision,
          })),
        }),
      );
    }
    try {
      return await repositories.contentPersistence.persistCollectedContent(input);
    } catch (error) {
      if (error instanceof SupabaseContentPersistenceError) {
        console.error(
          JSON.stringify({
            event: "supabase_test_persistence_blocked",
            stage: "collect",
            code: error.code,
          }),
        );
      }
      throw error;
    }
  },
  persistSelectedTopic:
    repositories.contentPersistence.persistSelectedTopic.bind(
      repositories.contentPersistence,
    ),
  persistEmptyTopicSelection:
    repositories.contentPersistence.persistEmptyTopicSelection.bind(
      repositories.contentPersistence,
    ),
};

const result = await runSupabaseDailyPipeline({
  store: repositories.dailyRun,
  workspace: repositories.workspace,
  contentPersistence,
  // Fixture-only sources never perform a physical request, so they must not
  // enter the production source policy/reservation table.
  sourceAttempt: {
    reserve: async ({ sourceId, minIntervalMs }) => ({
      status: "allowed" as const,
      sourceId,
      lastAttemptAt: `${runDateKst}T00:00:00+09:00`,
      nextAllowedAt: new Date(
        Date.parse(`${runDateKst}T00:00:00+09:00`) + minIntervalMs,
      ).toISOString(),
    }),
  },
  publisher: repositories.publisher,
  publishReceipt: repositories.publishReceipt,
  sources: testSources,
  collectSource: async (source) => collectionOutcome(source),
  generation: {
    configurationId: "development-test-publication-v1",
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
          providerId: "development-fixture",
          modelId: "development-generation-v1",
        },
        promptVersion: "generated-post-v2",
        reservationPolicyVersion: "development-fixed-v1",
        reservation: (request) => ({
          inputTokens: 500,
          outputTokens: request.maxOutputTokens,
          costUsd: 0,
        }),
      },
    ],
    semanticRoutes: [
      {
        evaluator: semanticEvaluator,
        providerId: "development-fixture",
        modelId: "development-semantic-v1",
        promptVersion: "semantic-evaluator-v1",
        reservationPolicyVersion: "development-fixed-v1",
        reservation: (request) => ({
          inputTokens: 500,
          outputTokens: request.maxOutputTokens,
          costUsd: 0,
        }),
      },
    ],
  },
  collectionConfigurationId: "development-fixture-sources-v1",
  previousPostTitles: history.titles,
  previousContentFingerprints: history.contentFingerprints,
  limits: {
    maxModelCalls: 2,
    maxInputTokens: 2_000,
    maxOutputTokens: 2_000,
    maxEstimatedCostUsd: 0.01,
    maxRunSeconds: 300,
  },
  ownerId: "development-test-publication",
});

if (result.status !== "executed" || result.journal.run.status !== "succeeded") {
  throw new Error(
    `TEST_PUBLICATION_FAILED:${
      result.status === "executed" ? result.journal.run.status : result.status
    }`,
  );
}

console.log(
  JSON.stringify({
    event: "supabase_test_publication_completed",
    runId: result.journal.run.runId,
    runDate: result.journal.run.runDate,
    modelCalls: result.journal.run.usage.modelCalls,
    published: true,
    fixtureOnly: true,
    actualGeminiCalls: false,
  }),
);
