import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import {
  AiSdkSemanticEvaluator,
  SEMANTIC_EVALUATOR_PROMPT_VERSION,
} from "../../src/pipeline/orchestrator";
import { GenerationProviderError } from "../../src/pipeline/generation";
import { validEvidenceItems, validGeneratedPost } from "../fixtures/content/quality";

function semanticRequest() {
  return {
    attemptNumber: 1 as const,
    post: validGeneratedPost(),
    evidenceItems: validEvidenceItems().map(
      ({
        evidenceId,
        publisherGroupId,
        provenanceGroupKey,
        sourceRole,
        sourceType,
        authority,
        publishedAt,
        publishedAtPrecision,
        sourceName,
        title,
        passage,
        locator,
      }) => ({
        evidenceId,
        publisherGroupId,
        provenanceGroupKey,
        sourceRole,
        sourceType,
        authority,
        publishedAt,
        publishedAtPrecision,
        sourceName,
        title,
        passage,
        locator,
      }),
    ),
    timeoutMs: 1_000,
    maxOutputTokens: 500,
    maxPhysicalCalls: 1,
  };
}

describe("AiSdkSemanticEvaluator", () => {
  it("스키마 부적합 응답의 사용량을 감사에 남겨 ledger finalize를 가능하게 한다", async () => {
    const model = new MockLanguageModelV4({
      provider: "google-gemini",
      modelId: "gemini-test",
      doGenerate: {
        content: [{ type: "text" as const, text: '{"passed":"not-boolean"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: {
            total: 410,
            noCache: 410,
            cacheRead: 0,
            cacheWrite: 0,
          },
          outputTokens: { total: 27, text: 27, reasoning: 0 },
        },
        response: {
          id: "semantic-invalid-response",
          timestamp: new Date("2026-08-13T00:00:00.000Z"),
          modelId: "gemini-test",
        },
        warnings: [],
      },
    });
    const evaluator = new AiSdkSemanticEvaluator({
      model,
      providerId: "google-gemini",
      modelId: "gemini-test",
      createCallId: () => "semantic-call-1",
      costEstimator: (usage) =>
        (usage.inputTokens * 1.5 + usage.outputTokens * 9) / 1_000_000,
    });

    await expect(evaluator.evaluate(semanticRequest())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GenerationProviderError &&
        error.code === "INVALID_MODEL_OUTPUT" &&
        error.audit?.callId === "semantic-call-1" &&
        error.audit.promptVersion === SEMANTIC_EVALUATOR_PROMPT_VERSION &&
        error.audit.usage.inputTokens === 410 &&
        error.audit.usage.outputTokens === 27 &&
        error.audit.estimatedCostUsd === (410 * 1.5 + 27 * 9) / 1_000_000 &&
        error.audit.responseId === "semantic-invalid-response",
    );
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
