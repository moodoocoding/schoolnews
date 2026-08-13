import { createHash } from "node:crypto";

import { z } from "zod";

import {
  evidenceItemSchema,
  generatedPostSchema,
  generationUsageSchema,
  identifierSchema,
  modelCallAuditSchema,
  normalizedArticleSchema,
  pipelineStageSchema,
  qualityResultSchema,
  sha256Schema,
  sourceCollectionOutcomeSchema,
  topicCandidateSchema,
  topicScoreSchema,
  type PipelineStage,
} from "../contracts";
import { generationProviderErrorCodes } from "../pipeline/generation";
import type { NewsIngestionResult } from "../pipeline/orchestrator/run-news-ingestion";
import type { PostGenerationResult } from "../pipeline/orchestrator/run-post-generation";

const WORKSPACE_REFERENCE_VERSION = "memws1";

const articleUpsertResultSchema = z
  .object({
    insertedCount: z.number().int().min(0),
    duplicateCount: z.number().int().min(0),
    totalCount: z.number().int().min(0),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.totalCount < result.insertedCount) {
      context.addIssue({
        code: "custom",
        path: ["totalCount"],
        message: "전체 기사 수는 이번 실행의 삽입 수보다 작을 수 없습니다.",
      });
    }
  });

const topicSignalsSchema = z
  .object({
    elementaryRelevance: z.number().min(0).max(1),
    aiDigitalSpecificity: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    novelty: z.number().min(0).max(1),
    socialMeaning: z.number().min(0).max(1),
  })
  .strict();

const topicThresholdNameSchema = z.enum([
  "total",
  "elementaryRelevance",
  "aiDigitalSpecificity",
  "reliability",
  "novelty",
]);

const topicThresholdResultSchema = z
  .object({
    passed: z.boolean(),
    failures: z.array(
      z
        .object({
          actual: z.number().min(0),
          minimum: z.number().min(0),
          threshold: topicThresholdNameSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.passed !== (result.failures.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["passed"],
        message: "후보 임계값 통과 여부와 실패 목록이 일치해야 합니다.",
      });
    }
  });

const newsCandidateAssessmentSchema = z
  .object({
    articleId: identifierSchema,
    evidenceIds: z.array(identifierSchema),
    signals: topicSignalsSchema,
    score: topicScoreSchema,
    threshold: topicThresholdResultSchema,
  })
  .strict();

const newsIngestionResultSchema: z.ZodType<NewsIngestionResult> = z
  .object({
    status: z.enum(["succeeded", "partial", "failed"]),
    outcomes: z.array(sourceCollectionOutcomeSchema),
    collectedCount: z.number().int().min(0),
    normalizedCount: z.number().int().min(0),
    deduplicatedCount: z.number().int().min(0),
    carriedCount: z.number().int().min(0).optional(),
    storage: articleUpsertResultSchema,
    articles: z.array(normalizedArticleSchema),
    evidenceItems: z.array(evidenceItemSchema),
    candidates: z.array(newsCandidateAssessmentSchema),
    runIssues: z.array(
      z
        .object({
          code: z.literal("NO_ENABLED_SOURCE"),
          message: z.string().trim().min(1).max(500),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((result, context) => {
    const collectedCount = result.outcomes.reduce(
      (total, outcome) => total + outcome.items.length,
      0,
    );
    if (result.collectedCount !== collectedCount) {
      context.addIssue({
        code: "custom",
        path: ["collectedCount"],
        message: "수집 수는 출처별 수집 항목의 합과 같아야 합니다.",
      });
    }
    if (
      result.normalizedCount !== result.collectedCount ||
      result.deduplicatedCount > result.normalizedCount ||
      result.articles.length !==
        result.deduplicatedCount + (result.carriedCount ?? 0) ||
      result.candidates.length !== result.deduplicatedCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["deduplicatedCount"],
        message: "수집·정규화·중복 제거·후보 수가 유효한 순서를 가져야 합니다.",
      });
    }
    if (
      result.storage.insertedCount + result.storage.duplicateCount !==
      result.deduplicatedCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["storage"],
        message: "저장 결과는 중복 제거된 입력 수와 일치해야 합니다.",
      });
    }
    const candidateIds = result.candidates.map((candidate) => candidate.articleId);
    if (new Set(candidateIds).size !== candidateIds.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "실행 내 후보 기사 ID는 고유해야 합니다.",
      });
    }
    if (result.runIssues.length > 0 && result.outcomes.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["runIssues"],
        message: "활성 수집원 없음 오류에는 출처 실행 결과가 있을 수 없습니다.",
      });
    }
    const failedCount = result.outcomes.filter(
      (outcome) => outcome.status === "failed",
    ).length;
    const expectedStatus =
      result.deduplicatedCount === 0 && failedCount === result.outcomes.length
        ? "failed"
        : failedCount > 0 ||
            result.outcomes.some((outcome) => outcome.status === "partial")
          ? "partial"
          : "succeeded";
    if (result.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "수집 실행 상태는 출처 결과와 사용 가능한 기사 수에서 결정되어야 합니다.",
      });
    }
    const articleIds = result.articles.map((article) => article.articleId);
    const articleIdSet = new Set(articleIds);
    if (articleIdSet.size !== articleIds.length) {
      context.addIssue({
        code: "custom",
        path: ["articles"],
        message: "정규화 기사 ID는 실행 안에서 고유해야 합니다.",
      });
    }
    const candidateArticleIds = result.candidates.map(
      (candidate) => candidate.articleId,
    );
    if (candidateArticleIds.some((articleId) => !articleIdSet.has(articleId))) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "후보 평가는 해당 실행의 모든 정규화 기사와 일치해야 합니다.",
      });
    }
    const evidenceIds = result.evidenceItems.map((item) => item.evidenceId);
    const evidenceIdSet = new Set(evidenceIds);
    if (evidenceIdSet.size !== evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceItems"],
        message: "선정 근거 ID는 고유해야 합니다.",
      });
    }
    if (
      result.candidates.flatMap((candidate) => candidate.evidenceIds).length !==
        evidenceIds.length ||
      result.candidates.some((candidate) =>
        candidate.evidenceIds.some((evidenceId) => !evidenceIdSet.has(evidenceId)),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "후보 평가 근거 ID는 저장된 근거와 정확히 일치해야 합니다.",
      });
    }
    if (result.evidenceItems.some((item) => !articleIdSet.has(item.articleId))) {
      context.addIssue({
        code: "custom",
        path: ["evidenceItems"],
        message: "수집 근거는 해당 실행의 정규화 기사에 속해야 합니다.",
      });
    }
  });

export const selectedTopicWorkspaceResultSchema = z
  .object({
    outcome: z.enum(["eligible", "none"]),
    candidate: topicCandidateSchema.nullable(),
    evidenceItems: z.array(evidenceItemSchema),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.outcome === "none" &&
      (result.candidate !== null || result.evidenceItems.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "후보 없음 결과에는 후보나 근거가 있을 수 없습니다.",
      });
      return;
    }
    if (
      result.outcome === "eligible" &&
      (result.candidate === null || result.evidenceItems.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "선정 결과에는 후보와 하나 이상의 근거가 필요합니다.",
      });
      return;
    }
    if (result.candidate === null) return;

    const evidenceIds = result.evidenceItems.map((item) => item.evidenceId);
    const evidenceIdSet = new Set(evidenceIds);
    if (evidenceIdSet.size !== evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceItems"],
        message: "선정 근거 ID는 고유해야 합니다.",
      });
    }
    if (
      result.candidate.evidenceIds.length !== evidenceIds.length ||
      result.candidate.evidenceIds.some((evidenceId) => !evidenceIdSet.has(evidenceId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidate", "evidenceIds"],
        message: "후보의 근거 ID는 저장된 근거와 정확히 일치해야 합니다.",
      });
    }
    const articleIds = new Set(result.candidate.articleIds);
    if (result.evidenceItems.some((item) => !articleIds.has(item.articleId))) {
      context.addIssue({
        code: "custom",
        path: ["evidenceItems"],
        message: "선정 근거는 후보 기사에 속해야 합니다.",
      });
    }
  });

const generationProviderErrorCodeSchema = z.enum(generationProviderErrorCodes);
const postGenerationAttemptSchema = z
  .object({
    attemptNumber: z.union([z.literal(1), z.literal(2)]),
    purpose: z.enum(["draft", "revision", "semantic_review"]),
    status: z.enum(["succeeded", "failed"]),
    audit: modelCallAuditSchema.nullable(),
    errorCode: generationProviderErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.status === "succeeded" && (attempt.audit === null || attempt.errorCode !== null)) {
      context.addIssue({
        code: "custom",
        message: "성공한 생성 시도에는 감사 기록만 있어야 합니다.",
      });
    }
    if (attempt.status === "failed" && attempt.errorCode === null) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "실패한 생성 시도에는 오류 코드가 필요합니다.",
      });
    }
    if (
      attempt.audit !== null &&
      (attempt.audit.attemptNumber !== attempt.attemptNumber ||
        attempt.audit.purpose !== attempt.purpose)
    ) {
      context.addIssue({
        code: "custom",
        path: ["audit"],
        message: "생성 시도와 감사 기록의 번호·목적이 일치해야 합니다.",
      });
    }
  });

const postGenerationResultSchema = z
  .object({
    status: z.enum(["validated", "withheld"]),
    post: generatedPostSchema.nullable(),
    qualityResult: qualityResultSchema.nullable(),
    audits: z.array(modelCallAuditSchema),
    attempts: z.array(postGenerationAttemptSchema),
    usage: generationUsageSchema,
    failureCode: z
      .enum(["MODEL_PROVIDER_ERROR", "BUDGET_EXCEEDED", "QUALITY_REJECTED"])
      .nullable(),
    providerErrorCode: generationProviderErrorCodeSchema.nullable(),
    pipelineVersion: z.literal("post-generation-v1"),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.status === "validated" &&
      (result.post === null ||
        result.qualityResult?.passed !== true ||
        result.failureCode !== null ||
        result.providerErrorCode !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "검증 완료 결과에는 통과한 게시물과 품질 결과가 필요합니다.",
      });
    }
    if (result.status === "withheld" && (result.post !== null || result.failureCode === null)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "보류 결과에는 게시물 없이 실패 코드가 필요합니다.",
      });
    }
    if (result.qualityResult?.passed === true && result.status !== "validated") {
      context.addIssue({
        code: "custom",
        path: ["qualityResult"],
        message: "통과한 품질 결과는 검증 완료 상태에서만 허용됩니다.",
      });
    }
    const auditIds = result.audits.map((audit) => audit.callId);
    if (new Set(auditIds).size !== auditIds.length) {
      context.addIssue({
        code: "custom",
        path: ["audits"],
        message: "모델 호출 감사 ID는 고유해야 합니다.",
      });
    }
    const auditIdSet = new Set(auditIds);
    if (
      result.attempts.some(
        (attempt) => attempt.audit !== null && !auditIdSet.has(attempt.audit.callId),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "시도 감사 기록은 결과 감사 장부에 포함되어야 합니다.",
      });
    }
    const attemptAuditIds = result.attempts.flatMap((attempt) =>
      attempt.audit === null ? [] : [attempt.audit.callId],
    );
    if (
      attemptAuditIds.length !== auditIds.length ||
      auditIds.some((auditId) => !attemptAuditIds.includes(auditId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["audits"],
        message: "모든 모델 감사 기록은 정확히 하나의 생성 시도와 연결되어야 합니다.",
      });
    }
    const auditedUsage = result.audits.reduce(
      (total, audit) => ({
        inputTokens: total.inputTokens + audit.usage.inputTokens,
        outputTokens: total.outputTokens + audit.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
    if (
      result.usage.modelCalls < result.audits.length ||
      result.usage.inputTokens < auditedUsage.inputTokens ||
      result.usage.outputTokens < auditedUsage.outputTokens ||
      (result.audits.some((audit) => audit.estimatedCostUsd === null) &&
        !result.usage.hasUnpricedCalls)
    ) {
      context.addIssue({
        code: "custom",
        path: ["usage"],
        message: "생성 사용량은 감사 장부의 호출·토큰·가격 정보를 모두 포함해야 합니다.",
      });
    }
    if (
      result.providerErrorCode !== null &&
      result.failureCode !== "MODEL_PROVIDER_ERROR"
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerErrorCode"],
        message: "공급자 오류 코드는 모델 공급자 실패 결과에만 허용됩니다.",
      });
    }
  });

export type SelectedTopicWorkspaceResult = z.infer<
  typeof selectedTopicWorkspaceResultSchema
>;

export type PipelineWorkspaceArtifact =
  | { kind: "news_ingestion"; value: NewsIngestionResult }
  | { kind: "topic_selection"; value: SelectedTopicWorkspaceResult }
  | { kind: "post_generation"; value: PostGenerationResult };

export type PipelineWorkspaceArtifactKind = PipelineWorkspaceArtifact["kind"];

export interface PutPipelineWorkspaceArtifactInput {
  runId: string;
  stage: PipelineStage;
  configurationFingerprint: string;
  parentOutputReferences: readonly string[];
  artifact: PipelineWorkspaceArtifact;
}

export interface PipelineWorkspaceReferenceScope {
  runId?: string;
  stage?: PipelineStage;
  kind?: PipelineWorkspaceArtifactKind;
}

export interface PutPipelineWorkspaceArtifactResult {
  outputReference: string;
  payloadFingerprint: string;
  created: boolean;
}

export interface PipelineWorkspaceArtifactMetadata {
  runId: string;
  stage: PipelineStage;
  kind: PipelineWorkspaceArtifactKind;
  payloadFingerprint: string;
  configurationFingerprint: string;
  parentOutputReferences: string[];
}

export interface PipelineWorkspaceStoredArtifact
  extends PipelineWorkspaceArtifactMetadata {
  artifact: PipelineWorkspaceArtifact;
  outputReference: string;
}

export type PipelineWorkspaceErrorCode =
  | "INVALID_ARTIFACT"
  | "INVALID_OUTPUT_REFERENCE"
  | "OUTPUT_NOT_FOUND"
  | "OUTPUT_SCOPE_MISMATCH"
  | "INVALID_ARTIFACT_LINEAGE"
  | "OUTPUT_CONFLICT";

export class PipelineWorkspaceError extends Error {
  readonly code: PipelineWorkspaceErrorCode;

  constructor(code: PipelineWorkspaceErrorCode, options?: ErrorOptions) {
    const messages: Record<PipelineWorkspaceErrorCode, string> = {
      INVALID_ARTIFACT: "실행 산출물이 유효한 런타임 계약을 통과하지 못했습니다.",
      INVALID_OUTPUT_REFERENCE: "실행 산출물 참조 형식이 유효하지 않습니다.",
      OUTPUT_NOT_FOUND: "실행 산출물 참조를 찾을 수 없습니다.",
      OUTPUT_SCOPE_MISMATCH: "실행 산출물 참조가 요청한 실행 범위와 일치하지 않습니다.",
      INVALID_ARTIFACT_LINEAGE: "실행 산출물의 단계, 설정 또는 선행 참조가 유효하지 않습니다.",
      OUTPUT_CONFLICT: "같은 실행 단계에 다른 산출물을 덮어쓸 수 없습니다.",
    };
    super(messages[code], options);
    this.name = "PipelineWorkspaceError";
    this.code = code;
  }
}

interface ParsedArtifact {
  kind: PipelineWorkspaceArtifactKind;
  value:
    | NewsIngestionResult
    | SelectedTopicWorkspaceResult
    | PostGenerationResult;
}

interface StoredArtifact extends ParsedArtifact {
  runId: string;
  stage: PipelineStage;
  payloadFingerprint: string;
  configurationFingerprint: string;
  parentOutputReferences: string[];
  outputReference: string;
}

const STAGE_BY_ARTIFACT_KIND: Readonly<
  Record<PipelineWorkspaceArtifactKind, PipelineStage>
> = {
  news_ingestion: "collect",
  topic_selection: "score",
  post_generation: "generate",
};

function parseArtifact(artifact: PipelineWorkspaceArtifact): ParsedArtifact {
  try {
    switch (artifact.kind) {
      case "news_ingestion":
        return {
          kind: artifact.kind,
          value: newsIngestionResultSchema.parse(artifact.value),
        };
      case "topic_selection":
        return {
          kind: artifact.kind,
          value: selectedTopicWorkspaceResultSchema.parse(artifact.value),
        };
      case "post_generation":
        return { kind: artifact.kind, value: postGenerationResultSchema.parse(artifact.value) };
      default:
        throw new PipelineWorkspaceError("INVALID_ARTIFACT");
    }
  } catch (error) {
    throw new PipelineWorkspaceError("INVALID_ARTIFACT", { cause: error });
  }
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new PipelineWorkspaceError("INVALID_ARTIFACT");
}

function payloadFingerprint(artifact: ParsedArtifact): string {
  const canonical = JSON.stringify(
    canonicalize({ kind: artifact.kind, value: artifact.value }),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function createOutputReference(input: {
  runId: string;
  stage: PipelineStage;
  kind: PipelineWorkspaceArtifactKind;
  outputFingerprint: string;
}): string {
  const encodedRunId = Buffer.from(input.runId, "utf8").toString("base64url");
  return [
    WORKSPACE_REFERENCE_VERSION,
    encodedRunId,
    input.stage,
    input.kind,
    input.outputFingerprint,
  ].join(".");
}

function parseOutputReference(outputReference: string): {
  runId: string;
  stage: PipelineStage;
  kind: PipelineWorkspaceArtifactKind;
  outputFingerprint: string;
} {
  try {
    const parts = outputReference.split(".");
    if (parts.length !== 5 || parts[0] !== WORKSPACE_REFERENCE_VERSION) {
      throw new Error("invalid reference shape");
    }
    const [, encodedRunId, unsafeStage, unsafeKind, unsafeFingerprint] = parts;
    if (!/^[A-Za-z0-9_-]+$/.test(encodedRunId)) {
      throw new Error("invalid run id encoding");
    }
    const runId = identifierSchema.parse(
      Buffer.from(encodedRunId, "base64url").toString("utf8"),
    );
    if (Buffer.from(runId, "utf8").toString("base64url") !== encodedRunId) {
      throw new Error("non-canonical run id encoding");
    }
    const stage = pipelineStageSchema.parse(unsafeStage);
    const kind = z
      .enum(["news_ingestion", "topic_selection", "post_generation"])
      .parse(unsafeKind);
    const outputFingerprint = sha256Schema.parse(unsafeFingerprint);
    return { runId, stage, kind, outputFingerprint };
  } catch (error) {
    throw new PipelineWorkspaceError("INVALID_OUTPUT_REFERENCE", { cause: error });
  }
}

function assertScope(
  actual: ReturnType<typeof parseOutputReference>,
  expected: Readonly<PipelineWorkspaceReferenceScope>,
): void {
  if (
    (expected.runId !== undefined && actual.runId !== expected.runId) ||
    (expected.stage !== undefined && actual.stage !== expected.stage) ||
    (expected.kind !== undefined && actual.kind !== expected.kind)
  ) {
    throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH");
  }
}

/**
 * Process-local workspace for composing M2/M3 outputs into the daily runner.
 * It is deliberately not a durability or multi-process synchronization layer.
 */
export class MemoryPipelineWorkspaceRepository {
  readonly #artifactsByRunStage = new Map<string, StoredArtifact>();
  readonly #artifactsByReference = new Map<string, StoredArtifact>();

  async putArtifact(
    input: Readonly<PutPipelineWorkspaceArtifactInput>,
  ): Promise<PutPipelineWorkspaceArtifactResult> {
    let runId: string;
    let stage: PipelineStage;
    let configurationFingerprint: string;
    let artifact: ParsedArtifact;
    try {
      runId = identifierSchema.parse(input.runId);
      stage = pipelineStageSchema.parse(input.stage);
      configurationFingerprint = sha256Schema.parse(
        input.configurationFingerprint,
      );
      artifact = parseArtifact(input.artifact);
    } catch (error) {
      if (error instanceof PipelineWorkspaceError) throw error;
      throw new PipelineWorkspaceError("INVALID_ARTIFACT", { cause: error });
    }

    if (STAGE_BY_ARTIFACT_KIND[artifact.kind] !== stage) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }

    const parentOutputReferences = [...input.parentOutputReferences].sort();
    if (
      new Set(parentOutputReferences).size !== parentOutputReferences.length ||
      (stage === "collect" && parentOutputReferences.length !== 0) ||
      (stage !== "collect" && parentOutputReferences.length === 0)
    ) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }
    const stageIndex = pipelineStageSchema.options.indexOf(stage);
    const requiredParentStage: PipelineStage | null =
      stage === "score" ? "collect" : stage === "generate" ? "score" : null;
    let hasRequiredParent = requiredParentStage === null;
    for (const parentReference of parentOutputReferences) {
      let parsedParent: ReturnType<typeof parseOutputReference>;
      try {
        parsedParent = parseOutputReference(parentReference);
      } catch (error) {
        throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE", {
          cause: error,
        });
      }
      if (
        parsedParent.runId !== runId ||
        pipelineStageSchema.options.indexOf(parsedParent.stage) >= stageIndex ||
        !this.#artifactsByReference.has(parentReference)
      ) {
        throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
      }
      if (parsedParent.stage === requiredParentStage) {
        hasRequiredParent = true;
      }
    }
    if (!hasRequiredParent) {
      throw new PipelineWorkspaceError("INVALID_ARTIFACT_LINEAGE");
    }

    const fingerprint = payloadFingerprint(artifact);
    const outputFingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          canonicalize({
            configurationFingerprint,
            kind: artifact.kind,
            parentOutputReferences,
            payloadFingerprint: fingerprint,
          }),
        ),
        "utf8",
      )
      .digest("hex");
    const outputReference = createOutputReference({
      runId,
      stage,
      kind: artifact.kind,
      outputFingerprint,
    });
    const key = `${runId}\u0000${stage}`;
    const existing = this.#artifactsByRunStage.get(key);
    if (existing !== undefined) {
      if (existing.outputReference !== outputReference) {
        throw new PipelineWorkspaceError("OUTPUT_CONFLICT");
      }
      return {
        outputReference: existing.outputReference,
        payloadFingerprint: existing.payloadFingerprint,
        created: false,
      };
    }

    const stored: StoredArtifact = {
      runId,
      stage,
      kind: artifact.kind,
      value: structuredClone(artifact.value),
      payloadFingerprint: fingerprint,
      configurationFingerprint,
      parentOutputReferences,
      outputReference,
    };
    this.#artifactsByRunStage.set(key, stored);
    this.#artifactsByReference.set(outputReference, stored);
    return { outputReference, payloadFingerprint: fingerprint, created: true };
  }

  async getArtifact(
    outputReference: string,
    expected: Readonly<PipelineWorkspaceReferenceScope> = {},
  ): Promise<PipelineWorkspaceArtifact> {
    const parsedReference = parseOutputReference(outputReference);
    assertScope(parsedReference, expected);
    const stored = this.#artifactsByReference.get(outputReference);
    if (stored === undefined) {
      throw new PipelineWorkspaceError("OUTPUT_NOT_FOUND");
    }
    assertScope(parsedReference, {
      runId: stored.runId,
      stage: stored.stage,
      kind: stored.kind,
    });
    const reparsed = parseArtifact({
      kind: stored.kind,
      value: structuredClone(stored.value),
    } as PipelineWorkspaceArtifact);
    const currentPayloadFingerprint = payloadFingerprint(reparsed);
    const currentOutputFingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          canonicalize({
            configurationFingerprint: stored.configurationFingerprint,
            kind: stored.kind,
            parentOutputReferences: stored.parentOutputReferences,
            payloadFingerprint: currentPayloadFingerprint,
          }),
        ),
        "utf8",
      )
      .digest("hex");
    if (
      currentPayloadFingerprint !== stored.payloadFingerprint ||
      currentOutputFingerprint !== parsedReference.outputFingerprint
    ) {
      throw new PipelineWorkspaceError("INVALID_OUTPUT_REFERENCE");
    }
    return structuredClone(reparsed) as PipelineWorkspaceArtifact;
  }

  async getArtifactMetadata(
    outputReference: string,
    expected: Readonly<PipelineWorkspaceReferenceScope> = {},
  ): Promise<PipelineWorkspaceArtifactMetadata> {
    await this.getArtifact(outputReference, expected);
    const stored = this.#artifactsByReference.get(outputReference);
    if (stored === undefined) {
      throw new PipelineWorkspaceError("OUTPUT_NOT_FOUND");
    }
    return structuredClone({
      runId: stored.runId,
      stage: stored.stage,
      kind: stored.kind,
      payloadFingerprint: stored.payloadFingerprint,
      configurationFingerprint: stored.configurationFingerprint,
      parentOutputReferences: stored.parentOutputReferences,
    });
  }

  async getArtifactForStage(input: {
    runId: string;
    stage: PipelineStage;
    kind: PipelineWorkspaceArtifactKind;
  }): Promise<PipelineWorkspaceStoredArtifact | null> {
    let runId: string;
    let stage: PipelineStage;
    let kind: PipelineWorkspaceArtifactKind;
    try {
      runId = identifierSchema.parse(input.runId);
      stage = pipelineStageSchema.parse(input.stage);
      kind = z
        .enum(["news_ingestion", "topic_selection", "post_generation"])
        .parse(input.kind);
    } catch (error) {
      throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH", {
        cause: error,
      });
    }
    if (STAGE_BY_ARTIFACT_KIND[kind] !== stage) {
      throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH");
    }

    const stored = this.#artifactsByRunStage.get(`${runId}\u0000${stage}`);
    if (stored === undefined) return null;
    if (stored.kind !== kind) {
      throw new PipelineWorkspaceError("OUTPUT_SCOPE_MISMATCH");
    }
    const artifact = await this.getArtifact(stored.outputReference, {
      runId,
      stage,
      kind,
    });
    return structuredClone({
      artifact,
      outputReference: stored.outputReference,
      runId: stored.runId,
      stage: stored.stage,
      kind: stored.kind,
      payloadFingerprint: stored.payloadFingerprint,
      configurationFingerprint: stored.configurationFingerprint,
      parentOutputReferences: stored.parentOutputReferences,
    });
  }

  async validateOutputReference(
    outputReference: string | null,
    expected: Readonly<PipelineWorkspaceReferenceScope> = {},
  ): Promise<boolean> {
    if (outputReference === null) return false;
    try {
      await this.getArtifact(outputReference, expected);
      return true;
    } catch {
      return false;
    }
  }
}
