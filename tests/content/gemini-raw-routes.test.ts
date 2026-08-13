import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createGeminiGeneration,
  createGeminiRawRoutesWithModelFactory,
  GEMINI_FREE_MODEL_CHAIN,
  GEMINI_PROVIDER_ID,
  GEMINI_RESERVATION_POLICY_VERSION,
} from "../../src/lib/ai/gemini-factory";
import {
  AiSdkGeneratedPostProvider,
  FallbackGeneratedPostProvider,
  GenerationProviderError,
} from "../../src/pipeline/generation";
import {
  AiSdkSemanticEvaluator,
  FallbackSemanticEvaluator,
  SEMANTIC_EVALUATOR_PROMPT_VERSION,
  type SupabaseDailyGeneratedRoute,
  type SupabaseDailySemanticRoute,
} from "../../src/pipeline/orchestrator";
import { GENERATED_POST_PROMPT_VERSION } from "../../src/prompts";
import { validEvidenceItems, validGeneratedPost } from "../fixtures/content/quality";

function modelResult(output: unknown, modelId: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: {
        total: 321,
        noCache: 321,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: { total: 123, text: 123, reasoning: 0 },
    },
    response: {
      id: `response-${modelId}`,
      timestamp: new Date("2026-08-13T00:00:00.000Z"),
      modelId,
    },
    warnings: [],
  };
}

function generationRequest() {
  return {
    attemptNumber: 1 as const,
    purpose: "draft" as const,
    evidenceItems: validEvidenceItems(),
    timeoutMs: 1_000,
    maxOutputTokens: 1_200,
    maxPhysicalCalls: 2,
  };
}

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
    maxPhysicalCalls: 2,
  };
}

function fakeRawRoutes() {
  const generatedModels = GEMINI_FREE_MODEL_CHAIN.map(
    (modelId) =>
      new MockLanguageModelV4({
        provider: GEMINI_PROVIDER_ID,
        modelId,
        doGenerate: modelResult(validGeneratedPost(), modelId),
      }),
  );
  const semanticModels = GEMINI_FREE_MODEL_CHAIN.map(
    (modelId) =>
      new MockLanguageModelV4({
        provider: GEMINI_PROVIDER_ID,
        modelId,
        doGenerate: modelResult(
          {
            passed: true,
            evaluatorVersion: SEMANTIC_EVALUATOR_PROMPT_VERSION,
            findings: [],
          },
          modelId,
        ),
      }),
  );
  const models = [...generatedModels, ...semanticModels];
  let index = 0;
  const factoryCalls: string[] = [];
  const routes = createGeminiRawRoutesWithModelFactory((modelId) => {
    factoryCalls.push(modelId);
    const model = models[index++];
    if (!model) throw new Error("fake model fixture exhausted");
    return model;
  });
  return { routes, generatedModels, semanticModels, factoryCalls };
}

describe("Gemini raw ledger routes", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("model별 raw route에 exact 메타데이터와 버전을 노출하고 fallback을 중첩하지 않는다", () => {
    const { routes, factoryCalls } = fakeRawRoutes();
    const generatedForSupabase: readonly SupabaseDailyGeneratedRoute[] =
      routes.generatedRoutes;
    const semanticForSupabase: readonly SupabaseDailySemanticRoute[] =
      routes.semanticRoutes;

    expect(routes.modelChain).toEqual(GEMINI_FREE_MODEL_CHAIN);
    expect(generatedForSupabase).toHaveLength(GEMINI_FREE_MODEL_CHAIN.length);
    expect(semanticForSupabase).toHaveLength(GEMINI_FREE_MODEL_CHAIN.length);
    expect(factoryCalls).toEqual([
      ...GEMINI_FREE_MODEL_CHAIN,
      ...GEMINI_FREE_MODEL_CHAIN,
    ]);
    expect(
      routes.generatedRoutes.map((route) => ({
        metadata: route.metadata,
        promptVersion: route.promptVersion,
        reservationPolicyVersion: route.reservationPolicyVersion,
      })),
    ).toEqual(
      GEMINI_FREE_MODEL_CHAIN.map((modelId) => ({
        metadata: { providerId: GEMINI_PROVIDER_ID, modelId },
        promptVersion: GENERATED_POST_PROMPT_VERSION,
        reservationPolicyVersion: GEMINI_RESERVATION_POLICY_VERSION,
      })),
    );
    expect(
      routes.semanticRoutes.map((route) => ({
        providerId: route.providerId,
        modelId: route.modelId,
        promptVersion: route.promptVersion,
        reservationPolicyVersion: route.reservationPolicyVersion,
      })),
    ).toEqual(
      GEMINI_FREE_MODEL_CHAIN.map((modelId) => ({
        providerId: GEMINI_PROVIDER_ID,
        modelId,
        promptVersion: SEMANTIC_EVALUATOR_PROMPT_VERSION,
        reservationPolicyVersion: GEMINI_RESERVATION_POLICY_VERSION,
      })),
    );
    expect(
      routes.generatedRoutes.every(
        (route) => route.provider instanceof AiSdkGeneratedPostProvider,
      ),
    ).toBe(true);
    expect(
      routes.semanticRoutes.every(
        (route) => route.evaluator instanceof AiSdkSemanticEvaluator,
      ),
    ).toBe(true);
    expect(
      routes.generatedRoutes.some(
        (route) => route.provider instanceof FallbackGeneratedPostProvider,
      ),
    ).toBe(false);
    expect(
      routes.semanticRoutes.some(
        (route) => route.evaluator instanceof FallbackSemanticEvaluator,
      ),
    ).toBe(false);
  });

  it("생성과 의미 평가 raw route가 가짜 모델만 1회 호출하고 보수적 토큰·비용을 예약한다", async () => {
    const { routes, generatedModels, semanticModels } = fakeRawRoutes();
    const generatedRoute = routes.generatedRoutes[0];
    const semanticRoute = routes.semanticRoutes[0];
    if (!generatedRoute || !semanticRoute) throw new Error("route fixture missing");

    const generatedReservation = generatedRoute.reservation(generationRequest());
    expect(generatedReservation).toMatchObject({ outputTokens: 1_200 });
    expect(generatedReservation.inputTokens).toBeGreaterThan(16_384);
    expect(generatedReservation.costUsd).toBe(
      (generatedReservation.inputTokens * 1.5 + 1_200 * 9) / 1_000_000,
    );
    const generated = await generatedRoute.provider.generate(generationRequest());
    expect(generated.audit).toMatchObject({
      providerId: GEMINI_PROVIDER_ID,
      modelId: GEMINI_FREE_MODEL_CHAIN[0],
      promptVersion: GENERATED_POST_PROMPT_VERSION,
      estimatedCostUsd: (321 * 1.5 + 123 * 9) / 1_000_000,
    });

    const semanticReservation = semanticRoute.reservation(semanticRequest());
    expect(semanticReservation).toMatchObject({ outputTokens: 500 });
    expect(semanticReservation.inputTokens).toBeGreaterThan(16_384);
    const evaluated = await semanticRoute.evaluator.evaluate(semanticRequest());
    expect(evaluated.audit).toMatchObject({
      providerId: GEMINI_PROVIDER_ID,
      modelId: GEMINI_FREE_MODEL_CHAIN[0],
      promptVersion: SEMANTIC_EVALUATOR_PROMPT_VERSION,
      estimatedCostUsd: (321 * 1.5 + 123 * 9) / 1_000_000,
    });

    expect(generatedModels[0]?.doGenerateCalls).toHaveLength(1);
    expect(generatedModels[1]?.doGenerateCalls).toHaveLength(0);
    expect(semanticModels[0]?.doGenerateCalls).toHaveLength(1);
    expect(semanticModels[1]?.doGenerateCalls).toHaveLength(0);
  });

  it("허용 크기의 한국어·JSON 입력에서도 예약이 mocked actual usage와 후속 호출 상한을 덮는다", () => {
    const { routes } = fakeRawRoutes();
    const generatedRoute = routes.generatedRoutes[0];
    const semanticRoute = routes.semanticRoutes[0];
    if (!generatedRoute || !semanticRoute) throw new Error("route fixture missing");

    const generation = generationRequest();
    generation.evidenceItems[0].passage = "가".repeat(1_950);
    generation.evidenceItems[1].passage = "나".repeat(1_950);
    generation.evidenceItems[0].locator = "다".repeat(290);
    generation.evidenceItems[1].locator = "라".repeat(290);
    const generatedReservation = generatedRoute.reservation(generation);

    const semantic = semanticRequest();
    semantic.evidenceItems[0].passage = "가".repeat(1_950);
    semantic.evidenceItems[1].passage = "나".repeat(1_950);
    semantic.evidenceItems[0].locator = "다".repeat(290);
    semantic.evidenceItems[1].locator = "라".repeat(290);
    const semanticReservation = semanticRoute.reservation(semantic);

    const mockedActualGeneratedInputTokens = 8_000;
    const mockedActualSemanticInputTokens = 8_500;
    expect(generatedReservation.inputTokens).toBeGreaterThanOrEqual(
      mockedActualGeneratedInputTokens,
    );
    expect(semanticReservation.inputTokens).toBeGreaterThanOrEqual(
      mockedActualSemanticInputTokens,
    );
    expect(generatedReservation.outputTokens).toBe(generation.maxOutputTokens);
    expect(semanticReservation.outputTokens).toBe(semantic.maxOutputTokens);
    expect(
      generatedReservation.costUsd + semanticReservation.costUsd,
    ).toBeLessThan(1);
  });

  it("PII gate가 예약과 물리 생성 호출 모두를 먼저 차단한다", async () => {
    const { routes, generatedModels } = fakeRawRoutes();
    const route = routes.generatedRoutes[0];
    if (!route) throw new Error("route fixture missing");
    const request = generationRequest();
    request.evidenceItems[0].passage = "학생 이름: 김민수, 3학년 2반 7번의 사례";

    expect(() => route.reservation(request)).toThrow("식별 가능 정보");
    await expect(route.provider.generate(request)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof GenerationProviderError &&
        error.code === "INVALID_GENERATION_INPUT",
    );
    expect(generatedModels[0]?.doGenerateCalls).toHaveLength(0);
    expect(generatedModels[1]?.doGenerateCalls).toHaveLength(0);
  });

  it("기존 createGeminiGeneration은 동일한 외부 형태와 단일 outer fallback을 유지한다", () => {
    const legacy = createGeminiGeneration({ apiKey: "x".repeat(24) });

    expect(legacy.modelChain).toEqual(GEMINI_FREE_MODEL_CHAIN);
    expect(legacy.provider).toBeInstanceOf(FallbackGeneratedPostProvider);
    expect(legacy.semanticEvaluator).toBeInstanceOf(FallbackSemanticEvaluator);
  });
});
