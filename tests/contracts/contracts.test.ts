import { describe, expect, it } from "vitest";

import {
  fetchableSourceUrlSchema,
  generatedPostSchema,
  dailyRetryPolicySchema,
  dailyRunJournalSchema,
  dailyRunLeaseSchema,
  generationBudgetSchema,
  isoTimestampSchema,
  modelCallAuditSchema,
  pipelineRunStateSchema,
  postRevisionDocumentSchema,
  postSlugDocumentSchema,
  publicationDateKstSchema,
  publishedPostContainerSchema,
  publishedPostDetailSchema,
  qualityResultSchema,
  sourceCollectionOutcomeSchema,
  sourceRegistryEntrySchema,
  semanticReviewSchema,
  topicCandidateSchema,
} from "../../src/contracts";
import {
  generatedPostFixture,
  pipelineRunStateFixture,
  publishedPostDetailFixture,
  topicCandidateFixture,
} from "../fixtures/contracts";

describe("공유 계약", () => {
  it("합의된 정상 픽스처를 허용한다", () => {
    expect(topicCandidateSchema.safeParse(topicCandidateFixture).success).toBe(true);
    expect(generatedPostSchema.safeParse(generatedPostFixture).success).toBe(true);
    expect(
      publishedPostDetailSchema.safeParse(publishedPostDetailFixture).success,
    ).toBe(true);
    expect(pipelineRunStateSchema.safeParse(pipelineRunStateFixture).success).toBe(
      true,
    );
  });

  it("실제 달력에 없는 KST 날짜를 거부한다", () => {
    expect(publicationDateKstSchema.safeParse("2026-02-30").success).toBe(false);
    expect(
      isoTimestampSchema.safeParse("2026-02-30T07:00:00+09:00").success,
    ).toBe(false);
  });

  it("수집 요청에 로컬 주소나 자격 증명이 포함된 URL을 거부한다", () => {
    expect(fetchableSourceUrlSchema.safeParse("https://localhost/news").success).toBe(
      false,
    );
    expect(
      fetchableSourceUrlSchema.safeParse("https://user:secret@example.com/news")
        .success,
    ).toBe(false);
  });

  it("검토되지 않은 수집원을 활성화하지 못하게 한다", () => {
    const source = {
      sourceId: "newsis-society",
      name: "뉴시스 사회 RSS",
      publisherGroupId: "newsis",
      provenanceGroupPrefix: "newsis",
      collectionType: "rss",
      feedUrl: "https://www.newsis.com/RSS/society.xml",
      siteUrl: "https://www.newsis.com/",
      publisherType: "wire",
      originType: "wire",
      sourceRole: "independent",
      sourceType: "news",
      authority: "none",
      contentUse: "discovery_only",
      locale: "ko-KR",
      enabled: true,
      accessStatus: "needs_review",
      accessReviewedAt: "2026-08-12T10:00:00+09:00",
      policyReferenceUrls: ["https://www.newsis.com/RSS/"],
      requestPolicy: {
        timeoutMs: 10_000,
        minIntervalMs: 21_600_000,
        maxResponseBytes: 1_000_000,
        maxItemsPerRun: 50,
        maxRedirects: 3,
      },
      notes: "공식 RSS 안내가 확인된 뉴스 메타데이터 피드입니다.",
    };

    expect(sourceRegistryEntrySchema.safeParse(source).success).toBe(false);
    expect(
      sourceRegistryEntrySchema.safeParse({
        ...source,
        accessStatus: "allowed",
      }).success,
    ).toBe(true);
  });

  it("수집 부분 성공과 전체 실패의 결과 의미를 검증한다", () => {
    const base = {
      sourceId: "newsis-society",
      startedAt: "2026-08-12T06:00:00+09:00",
      finishedAt: "2026-08-12T06:00:01+09:00",
    };
    const issue = {
      code: "ITEM_SKIPPED",
      message: "발행일이 없는 항목을 제외했습니다.",
      retryable: false,
      itemIndex: 2,
    };
    const item = {
      sourceId: "newsis-society",
      externalId: "article-1",
      originalUrl: "https://www.newsis.com/view/article-1",
      title: "학교의 인공지능 교육 소식",
      excerpt: null,
      author: null,
      publisher: "뉴시스",
      publishedAt: "2026-08-12T05:00:00+09:00",
      publishedAtPrecision: "instant",
      discoveredAt: "2026-08-12T06:00:00+09:00",
    };

    expect(
      sourceCollectionOutcomeSchema.safeParse({
        ...base,
        status: "partial",
        items: [item],
        issues: [issue],
      }).success,
    ).toBe(true);
    expect(
      sourceCollectionOutcomeSchema.safeParse({
        ...base,
        status: "failed",
        items: [item],
        issues: [issue],
      }).success,
    ).toBe(false);

    expect(
      sourceCollectionOutcomeSchema.safeParse({
        ...base,
        status: "succeeded",
        items: [{ ...item, sourceId: "different-source" }],
        issues: [],
      }).success,
    ).toBe(false);
  });

  it("세부 점수의 합과 다른 후보 총점을 거부한다", () => {
    const invalidCandidate = structuredClone(topicCandidateFixture);
    invalidCandidate.score.total = 99;

    expect(topicCandidateSchema.safeParse(invalidCandidate).success).toBe(false);
  });

  it("AI·디지털 구체성이 낮은 후보를 선정 가능 상태로 허용하지 않는다", () => {
    const invalidCandidate = structuredClone(topicCandidateFixture);
    invalidCandidate.score.total -= invalidCandidate.score.aiDigitalSpecificity;
    invalidCandidate.score.aiDigitalSpecificity = 0;

    expect(topicCandidateSchema.safeParse(invalidCandidate).success).toBe(false);
  });

  it("근거 없는 사실 주장을 거부한다", () => {
    const invalidPost = structuredClone(generatedPostFixture);
    invalidPost.claims[0].evidenceRefs = [];

    expect(generatedPostSchema.safeParse(invalidPost).success).toBe(false);
  });

  it("공개 문장에서 참조하지 않는 고아 주장을 거부한다", () => {
    const invalidPost = structuredClone(generatedPostFixture);
    invalidPost.claims.push({
      claimId: "orphaned-claim",
      text: "화면에 쓰이지 않는 고아 주장이다.",
      kind: "fact",
      importance: "supporting",
      displayCitation: false,
      evidenceRefs: [{ evidenceId: "evidence-2", support: "direct" }],
    });

    expect(generatedPostSchema.safeParse(invalidPost).success).toBe(false);
  });

  it("서로 모순되는 독립성 결과를 거부한다", () => {
    const invalidCandidate = structuredClone(topicCandidateFixture);
    invalidCandidate.independence.qualifyingGroupCount = 1;
    invalidCandidate.independence.reasons = ["same_owner"];

    expect(topicCandidateSchema.safeParse(invalidCandidate).success).toBe(false);
  });

  it("실패 검사 없이 차단된 품질 결과를 거부한다", () => {
    const result = qualityResultSchema.safeParse({
      passed: false,
      checks: [
        {
          type: "format",
          passed: true,
          reasons: [],
          checkerVersion: "v1",
        },
      ],
      blockingReasons: ["BUDGET_EXCEEDED"],
    });

    expect(result.success).toBe(false);
  });

  it("현재 단계와 단계 상태가 모순된 실행을 거부한다", () => {
    const invalidRun = structuredClone(pipelineRunStateFixture);
    invalidRun.currentStage = "publish";

    expect(pipelineRunStateSchema.safeParse(invalidRun).success).toBe(false);
  });

  it("모델 호출 감사·예산·의미 검사 계약을 검증한다", () => {
    expect(
      modelCallAuditSchema.safeParse({
        callId: "call-1",
        attemptNumber: 1,
        purpose: "draft",
        providerId: "fake",
        modelId: "test-model",
        promptVersion: "generated-post-v2",
        startedAt: "2026-08-13T08:00:00+09:00",
        finishedAt: "2026-08-13T08:00:01+09:00",
        evidenceIds: ["evidence-1"],
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        estimatedCostUsd: 0,
        finishReason: "stop",
        responseId: "response-1",
      }).success,
    ).toBe(true);
    expect(
      generationBudgetSchema.safeParse({
        maxModelCalls: 2,
        maxInputTokens: 10_000,
        maxOutputTokens: 4_000,
        maxEstimatedCostUsd: 1,
        maxCallSeconds: 60,
      }).success,
    ).toBe(true);
    expect(
      semanticReviewSchema.safeParse({
        passed: false,
        evaluatorVersion: "semantic-v1",
        findings: [
          {
            code: "PROMOTIONAL_LANGUAGE",
            message: "홍보성 표현이 포함됐습니다.",
            claimIds: [],
            evidenceIds: [],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("모델 호출 감사의 모순된 토큰·시간을 거부한다", () => {
    const invalidAudit = {
      callId: "call-1",
      attemptNumber: 1,
      purpose: "draft",
      providerId: "fake",
      modelId: "test-model",
      promptVersion: "generated-post-v2",
      startedAt: "2026-08-13T08:00:01+09:00",
      finishedAt: "2026-08-13T08:00:00+09:00",
      evidenceIds: ["evidence-1", "evidence-1"],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 149 },
      estimatedCostUsd: null,
      finishReason: null,
      responseId: null,
    };

    expect(modelCallAuditSchema.safeParse(invalidAudit).success).toBe(false);
    expect(
      semanticReviewSchema.safeParse({
        passed: true,
        evaluatorVersion: "semantic-v1",
        findings: [
          {
            code: "SOURCE_CONFLICT",
            message: "출처가 충돌합니다.",
            claimIds: ["claim-1"],
            evidenceIds: ["evidence-1"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("일일 실행 저널·임대·재시도 정책 계약을 검증한다", () => {
    expect(
      dailyRunJournalSchema.safeParse({
        schemaVersion: "daily-run-v1",
        revision: 1,
        run: pipelineRunStateFixture,
        attempts: [
          {
            stage: "collect",
            attemptNumber: 1,
            status: "succeeded",
            inputFingerprint: "a".repeat(64),
            outputReference: "collector-run-1",
            startedAt: "2026-08-12T06:00:00+09:00",
            finishedAt: "2026-08-12T06:01:00+09:00",
            errorCode: null,
            retryable: false,
            retryDelayMs: 0,
          },
        ],
        terminalReason: null,
        startedAt: "2026-08-12T06:00:00+09:00",
        finishedAt: null,
        updatedAt: "2026-08-12T06:02:00+09:00",
      }).success,
    ).toBe(true);
    expect(
      dailyRunLeaseSchema.safeParse({
        runDate: "2026-08-12",
        runId: "run-20260812",
        ownerId: "worker-1",
        leaseToken: "lease-1",
        fence: 1,
        acquiredAt: "2026-08-12T06:00:00+09:00",
        expiresAt: "2026-08-12T06:05:00+09:00",
      }).success,
    ).toBe(true);
    expect(
      dailyRetryPolicySchema.safeParse({
        maxAttempts: 3,
        initialDelayMs: 1_000,
        multiplier: 2,
        maxDelayMs: 10_000,
        timeoutMs: 30_000,
      }).success,
    ).toBe(true);
  });

  it("중복·비연속 시도와 역전된 임대 시각을 거부한다", () => {
    const invalidRun = structuredClone(pipelineRunStateFixture);
    invalidRun.steps[0].attemptNumber = 2;
    expect(
      dailyRunJournalSchema.safeParse({
        schemaVersion: "daily-run-v1",
        revision: 1,
        run: invalidRun,
        attempts: [
          {
            stage: "collect",
            attemptNumber: 2,
            status: "failed",
            inputFingerprint: null,
            outputReference: null,
            startedAt: "2026-08-12T06:00:00+09:00",
            finishedAt: "2026-08-12T06:00:01+09:00",
            errorCode: "SOURCE_UNAVAILABLE",
            retryable: false,
            retryDelayMs: 0,
          },
        ],
        terminalReason: null,
        startedAt: "2026-08-12T06:00:00+09:00",
        finishedAt: null,
        updatedAt: "2026-08-12T06:02:00+09:00",
      }).success,
    ).toBe(false);
    expect(
      dailyRunLeaseSchema.safeParse({
        runDate: "2026-08-12",
        runId: "run-20260812",
        ownerId: "worker-1",
        leaseToken: "lease-1",
        fence: 1,
        acquiredAt: "2026-08-12T06:05:00+09:00",
        expiresAt: "2026-08-12T06:00:00+09:00",
      }).success,
    ).toBe(false);
  });

  it("발행 성공 없는 발행 완료 상태를 거부한다", () => {
    const invalidRun = structuredClone(pipelineRunStateFixture);
    invalidRun.status = "published_with_warning";
    invalidRun.currentStage = null;
    invalidRun.steps.forEach((step) => {
      if (step.status === "running") {
        step.status = "skipped";
        step.finishedAt = "2026-08-12T06:03:00+09:00";
      }
    });

    expect(pipelineRunStateSchema.safeParse(invalidRun).success).toBe(false);
  });

  it("공개 본문이 존재하지 않는 출처를 가리키면 거부한다", () => {
    const invalidPost = structuredClone(publishedPostDetailFixture);
    invalidPost.body[0].claims[0].sourceIds = ["missing-source"];

    expect(publishedPostDetailSchema.safeParse(invalidPost).success).toBe(false);
  });

  it("출처가 없거나 중복된 공개 문장을 거부한다", () => {
    const missingSourcePost = structuredClone(publishedPostDetailFixture);
    missingSourcePost.oneLineSummary.sourceIds = [];
    expect(publishedPostDetailSchema.safeParse(missingSourcePost).success).toBe(
      false,
    );

    const duplicateSourcePost = structuredClone(publishedPostDetailFixture);
    const sourceId = duplicateSourcePost.body[0].claims[0].sourceIds[0];
    duplicateSourcePost.body[0].claims[0].sourceIds = [sourceId, sourceId];
    expect(
      publishedPostDetailSchema.safeParse(duplicateSourcePost).success,
    ).toBe(false);
  });

  it("Firestore 공개 컨테이너, 활성 리비전과 slug 예약을 검증한다", () => {
    const container = {
      schemaVersion: "firestore-v1",
      id: publishedPostDetailFixture.id,
      slug: publishedPostDetailFixture.slug,
      publicationDateKst: publishedPostDetailFixture.publicationDateKst,
      status: "published",
      activeRevisionId: "revision-001",
      publishedAt: publishedPostDetailFixture.publishedAt,
      modifiedAt: publishedPostDetailFixture.modifiedAt,
      title: publishedPostDetailFixture.title,
      summary: publishedPostDetailFixture.summary,
      visual: publishedPostDetailFixture.visual,
    };

    expect(publishedPostContainerSchema.safeParse(container).success).toBe(true);
    expect(
      postRevisionDocumentSchema.safeParse({
        schemaVersion: "firestore-v1",
        revisionId: "revision-001",
        postId: publishedPostDetailFixture.id,
        createdAt: publishedPostDetailFixture.modifiedAt,
        detail: publishedPostDetailFixture,
      }).success,
    ).toBe(true);
    expect(
      postSlugDocumentSchema.safeParse({
        schemaVersion: "firestore-v1",
        slug: publishedPostDetailFixture.slug,
        postDocumentId: publishedPostDetailFixture.publicationDateKst,
        postId: publishedPostDetailFixture.id,
      }).success,
    ).toBe(true);
  });

  it("Firestore 리비전의 postId와 상세 ID가 다르면 거부한다", () => {
    expect(
      postRevisionDocumentSchema.safeParse({
        schemaVersion: "firestore-v1",
        revisionId: "revision-001",
        postId: "different-post",
        createdAt: publishedPostDetailFixture.modifiedAt,
        detail: publishedPostDetailFixture,
      }).success,
    ).toBe(false);
  });

  it("Firestore 리비전과 상세의 감사 시각이 모순되면 거부한다", () => {
    expect(
      postRevisionDocumentSchema.safeParse({
        schemaVersion: "firestore-v1",
        revisionId: "revision-001",
        postId: publishedPostDetailFixture.id,
        createdAt: "2026-08-12T08:00:00+09:00",
        detail: publishedPostDetailFixture,
      }).success,
    ).toBe(false);

    const invalidDetail = structuredClone(publishedPostDetailFixture);
    invalidDetail.modifiedAt = "2026-08-12T06:59:59+09:00";
    expect(
      postRevisionDocumentSchema.safeParse({
        schemaVersion: "firestore-v1",
        revisionId: "revision-001",
        postId: invalidDetail.id,
        createdAt: invalidDetail.modifiedAt,
        detail: invalidDetail,
      }).success,
    ).toBe(false);
  });

  it("publishedAt 순간과 다른 KST 게시일을 거부한다", () => {
    const invalidDetail = structuredClone(publishedPostDetailFixture);
    invalidDetail.publicationDateKst = "2026-08-11";
    expect(publishedPostDetailSchema.safeParse(invalidDetail).success).toBe(
      false,
    );

    expect(
      publishedPostContainerSchema.safeParse({
        schemaVersion: "firestore-v1",
        id: publishedPostDetailFixture.id,
        slug: publishedPostDetailFixture.slug,
        publicationDateKst: "2026-08-11",
        status: "published",
        activeRevisionId: "revision-001",
        publishedAt: publishedPostDetailFixture.publishedAt,
        modifiedAt: publishedPostDetailFixture.modifiedAt,
        title: publishedPostDetailFixture.title,
        summary: publishedPostDetailFixture.summary,
        visual: publishedPostDetailFixture.visual,
      }).success,
    ).toBe(false);
  });
});
