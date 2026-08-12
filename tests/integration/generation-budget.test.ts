import { describe, expect, it } from "vitest";

import type { ModelCallAudit } from "../../src/contracts";
import {
  EMPTY_GENERATION_USAGE,
  canStartModelCall,
  evaluateGenerationBudget,
  recordModelCall,
} from "../../src/pipeline/orchestrator";

const budget = {
  maxModelCalls: 2,
  maxInputTokens: 1_000,
  maxOutputTokens: 500,
  maxEstimatedCostUsd: 0.1,
  maxCallSeconds: 30,
} as const;

function audit(overrides: Partial<ModelCallAudit> = {}): ModelCallAudit {
  return {
    callId: "call-1",
    attemptNumber: 1,
    purpose: "draft",
    providerId: "fake",
    modelId: "fake-model",
    promptVersion: "generated-post-v2",
    startedAt: "2026-08-13T08:00:00+09:00",
    finishedAt: "2026-08-13T08:00:01+09:00",
    evidenceIds: ["evidence-1"],
    usage: { inputTokens: 300, outputTokens: 100, totalTokens: 400 },
    estimatedCostUsd: 0.02,
    finishReason: "stop",
    responseId: "response-1",
    ...overrides,
  };
}

describe("생성 예산 게이트", () => {
  it("모델 호출 감사값을 누적하고 한도 안에서는 통과시킨다", () => {
    const usage = recordModelCall(EMPTY_GENERATION_USAGE, audit());

    expect(usage).toEqual({
      modelCalls: 1,
      inputTokens: 300,
      outputTokens: 100,
      estimatedCostUsd: 0.02,
      hasUnpricedCalls: false,
    });
    expect(evaluateGenerationBudget(usage, budget)).toEqual({
      passed: true,
      issues: [],
    });
    expect(canStartModelCall(usage, budget)).toBe(true);
  });

  it("두 번째 호출 뒤에는 추가 재작성을 시작하지 않는다", () => {
    const first = recordModelCall(EMPTY_GENERATION_USAGE, audit());
    const second = recordModelCall(
      first,
      audit({ callId: "call-2", attemptNumber: 2, purpose: "revision" }),
    );

    expect(evaluateGenerationBudget(second, budget).passed).toBe(true);
    expect(canStartModelCall(second, budget)).toBe(false);
  });

  it("토큰·비용 초과와 가격을 알 수 없는 호출을 모두 fail-closed한다", () => {
    const over = recordModelCall(
      EMPTY_GENERATION_USAGE,
      audit({
        usage: { inputTokens: 1_001, outputTokens: 501, totalTokens: 1_502 },
        estimatedCostUsd: 0.11,
      }),
    );
    expect(evaluateGenerationBudget(over, budget).issues).toEqual([
      "INPUT_TOKEN_LIMIT",
      "OUTPUT_TOKEN_LIMIT",
      "ESTIMATED_COST_LIMIT",
    ]);

    const unpriced = recordModelCall(
      EMPTY_GENERATION_USAGE,
      audit({ estimatedCostUsd: null }),
    );
    expect(evaluateGenerationBudget(unpriced, budget)).toEqual({
      passed: false,
      issues: ["UNPRICED_MODEL_CALL"],
    });
  });
});
