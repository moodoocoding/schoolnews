import { describe, expect, it } from "vitest";

import type {
  GeneratedPost,
  ModelCallAudit,
} from "../../src/contracts";
import {
  DeterministicFakeGeneratedPostProvider,
  GenerationProviderError,
  type GeneratedPostProvider,
} from "../../src/pipeline/generation";
import {
  runPostGeneration,
  type PostGenerationSemanticEvaluator,
} from "../../src/pipeline/orchestrator";
import {
  validArticleDocuments,
  validEvidenceItems,
  validGeneratedPost,
} from "../fixtures/content/quality";

const budget = {
  maxModelCalls: 4,
  maxInputTokens: 2_000,
  maxOutputTokens: 1_000,
  maxEstimatedCostUsd: 0.1,
  maxCallSeconds: 30,
} as const;
const priced = () => 0.01;
const semanticEvaluator: PostGenerationSemanticEvaluator = {
  async evaluate(input) {
    return {
      review: {
        passed: true,
        evaluatorVersion: "fake-semantic-evaluator-v1",
        findings: [],
      },
      audit: {
        callId: `semantic-${input.attemptNumber}`,
        attemptNumber: input.attemptNumber,
        purpose: "semantic_review" as const,
        providerId: "fake-semantic",
        modelId: "fake-semantic-model",
        promptVersion: "semantic-review-v1",
        startedAt: "2026-08-13T00:00:00.000Z",
        finishedAt: "2026-08-13T00:00:01.000Z",
        evidenceIds: input.evidenceItems.map((item) => item.evidenceId),
        usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
        estimatedCostUsd: 0.001,
        finishReason: "stop",
        responseId: null,
      },
    };
  },
};

function fake(post: GeneratedPost | ((request: { purpose: string }) => unknown)) {
  return new DeterministicFakeGeneratedPostProvider({
    post,
    metadata: { providerId: "fake", modelId: "fake-model" },
    costEstimator: priced,
  });
}

describe("게시물 생성 오케스트레이터", () => {
  it("구조·의미·예산을 통과한 초안만 반환한다", async () => {
    const provider = fake(validGeneratedPost());
    const result = await runPostGeneration({
      provider,
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget,
      semanticEvaluator,
    });

    expect(result.status).toBe("validated");
    expect(result.post?.title).toBe(validGeneratedPost().title);
    expect(result.qualityResult?.passed).toBe(true);
    expect(result.audits).toHaveLength(2);
    expect(result.usage.modelCalls).toBe(2);
    expect(result.attempts.map((attempt) => attempt.purpose)).toEqual([
      "draft",
      "semantic_review",
    ]);
    expect(result.failureCode).toBeNull();
  });

  it("수정 가능한 실패는 한 번만 고친 뒤 재검사한다", async () => {
    const provider = fake((request) => {
      const post = validGeneratedPost();
      if (request.purpose === "draft") {
        post.title = "완벽한 AI 교육 혁명";
      }
      return post;
    });
    const result = await runPostGeneration({
      provider,
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget,
      semanticEvaluator,
    });

    expect(result.status).toBe("validated");
    expect(provider.calls.map((call) => call.purpose)).toEqual([
      "draft",
      "revision",
    ]);
    expect(provider.calls[1].revisionReasons).toContain("PROMOTIONAL_LANGUAGE");
    expect(result.audits).toHaveLength(4);
    expect(result.attempts.map((attempt) => attempt.purpose)).toEqual([
      "draft",
      "semantic_review",
      "revision",
      "semantic_review",
    ]);
  });

  it("수정본도 실패하면 초안을 노출하지 않고 보류한다", async () => {
    const post = validGeneratedPost();
    post.title = "완벽한 AI 교육 혁명";
    const provider = fake(post);
    const result = await runPostGeneration({
      provider,
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget,
      semanticEvaluator,
    });

    expect(result.status).toBe("withheld");
    expect(result.post).toBeNull();
    expect(result.failureCode).toBe("QUALITY_REJECTED");
    expect(result.qualityResult?.blockingReasons).toContain(
      "PROMOTIONAL_LANGUAGE",
    );
    expect(provider.calls).toHaveLength(2);
  });

  it("출처 부족은 글 수정으로 해결하지 않고 첫 호출 뒤 보류한다", async () => {
    const provider = fake(validGeneratedPost());
    const result = await runPostGeneration({
      provider,
      evidenceItems: [validEvidenceItems()[0]],
      articleDocuments: [validArticleDocuments()[0]],
      evidencePolicy: "primary_plus_independent",
      budget,
      semanticEvaluator,
    });

    expect(result.status).toBe("withheld");
    expect(result.post).toBeNull();
    expect(result.qualityResult?.blockingReasons).toContain("MISSING_EVIDENCE");
    expect(provider.calls).toHaveLength(1);
  });

  it("가격을 모르는 호출은 결과를 검사하기 전 예산 초과로 보류한다", async () => {
    const provider = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "fake", modelId: "unpriced-model" },
    });
    const result = await runPostGeneration({
      provider,
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget,
      semanticEvaluator,
    });

    expect(result.status).toBe("withheld");
    expect(result.post).toBeNull();
    expect(result.failureCode).toBe("BUDGET_EXCEEDED");
    expect(result.usage.hasUnpricedCalls).toBe(true);
  });

  it("공급자 오류의 세부 원인을 노출하지 않고 안정 코드만 반환한다", async () => {
    const provider = new DeterministicFakeGeneratedPostProvider({
      post: validGeneratedPost(),
      metadata: { providerId: "fake", modelId: "fake-model" },
      costEstimator: priced,
      failWith: new GenerationProviderError("PROVIDER_TIMEOUT"),
    });
    const result = await runPostGeneration({
      provider,
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget,
      semanticEvaluator,
    });

    expect(result.status).toBe("withheld");
    expect(result.failureCode).toBe("MODEL_PROVIDER_ERROR");
    expect(result.providerErrorCode).toBe("PROVIDER_TIMEOUT");
    expect(result.post).toBeNull();
    expect(result.usage.modelCalls).toBe(1);
    expect(result.usage.hasUnpricedCalls).toBe(true);
    expect(result.attempts).toEqual([
      expect.objectContaining({ status: "failed", audit: null }),
    ]);
  });

  it("의미 평가기의 호출·토큰·비용도 같은 예산 장부에 합산한다", async () => {
    const expensiveEvaluator: PostGenerationSemanticEvaluator = {
      async evaluate(input) {
        const evaluated = await semanticEvaluator.evaluate(input);
        return {
          ...evaluated,
          audit: { ...evaluated.audit, estimatedCostUsd: 0.2 },
        };
      },
    };
    const result = await runPostGeneration({
      provider: fake(validGeneratedPost()),
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget,
      semanticEvaluator: expensiveEvaluator,
    });

    expect(result.status).toBe("withheld");
    expect(result.post).toBeNull();
    expect(result.failureCode).toBe("BUDGET_EXCEEDED");
    expect(result.usage.modelCalls).toBe(2);
    expect(result.usage.estimatedCostUsd).toBeCloseTo(0.21);
    expect(result.attempts.at(-1)?.purpose).toBe("semantic_review");
  });

  it("남은 호출 슬롯이 없으면 의미 평가기를 호출하지 않는다", async () => {
    let evaluatorCalls = 0;
    const countingEvaluator: PostGenerationSemanticEvaluator = {
      async evaluate(input) {
        evaluatorCalls += 1;
        return semanticEvaluator.evaluate(input);
      },
    };
    const result = await runPostGeneration({
      provider: fake(validGeneratedPost()),
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget: { ...budget, maxModelCalls: 1 },
      semanticEvaluator: countingEvaluator,
    });

    expect(result.status).toBe("withheld");
    expect(result.failureCode).toBe("BUDGET_EXCEEDED");
    expect(result.usage.modelCalls).toBe(1);
    expect(evaluatorCalls).toBe(0);
  });

  it("공급자가 다른 근거의 감사 기록을 반환하면 fail-closed한다", async () => {
    const baseProvider = fake(validGeneratedPost());
    const provider: GeneratedPostProvider = {
      async generate(request) {
        const result = await baseProvider.generate(request);
        const audit: ModelCallAudit = {
          ...result.audit,
          evidenceIds: ["different-evidence"],
        };
        return { ...result, audit };
      },
    };
    const result = await runPostGeneration({
      provider,
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget,
      semanticEvaluator,
    });

    expect(result.status).toBe("withheld");
    expect(result.failureCode).toBe("MODEL_PROVIDER_ERROR");
    expect(result.post).toBeNull();
    expect(result.audits).toEqual([]);
    expect(result.usage.modelCalls).toBe(1);
  });

  it("외부 의미 평가기가 없으면 비수치 환각 가능성을 fail-closed한다", async () => {
    const post = validGeneratedPost();
    post.oneLineSummary.text = "교육부는 모든 학생에게 우주선을 제공했습니다.";
    post.claims[0].text = "교육부는 모든 학생에게 우주선을 제공했다.";
    const provider = fake(post);
    const result = await runPostGeneration({
      provider,
      evidenceItems: validEvidenceItems(),
      articleDocuments: validArticleDocuments(),
      evidencePolicy: "primary_plus_independent",
      budget,
    });

    expect(result.status).toBe("withheld");
    expect(result.post).toBeNull();
    expect(result.qualityResult?.blockingReasons).toContain("SOURCE_CONFLICT");
    expect(provider.calls).toHaveLength(1);
  });
});
