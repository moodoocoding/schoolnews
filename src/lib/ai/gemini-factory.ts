import { createGoogle } from "@ai-sdk/google";

import {
  AiSdkGeneratedPostProvider,
  FallbackGeneratedPostProvider,
} from "../../pipeline/generation";
import {
  AiSdkSemanticEvaluator,
  FallbackSemanticEvaluator,
} from "../../pipeline/orchestrator";

export const GEMINI_FREE_MODEL_CHAIN = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
] as const;

export function createGeminiGeneration(input: { apiKey: string }) {
  if (input.apiKey.trim().length < 20 || /\s/u.test(input.apiKey)) {
    throw new Error("Google Gemini API 키 설정이 유효하지 않습니다.");
  }
  const google = createGoogle({ apiKey: input.apiKey });
  const conservativePaidTierEstimator = (usage: {
    inputTokens: number;
    outputTokens: number;
  }) =>
    (usage.inputTokens * 1.5 + usage.outputTokens * 9) / 1_000_000;
  const providers = GEMINI_FREE_MODEL_CHAIN.map(
    (modelId) =>
      new AiSdkGeneratedPostProvider({
        model: google(modelId),
        metadata: { providerId: "google-gemini", modelId },
        costEstimator: conservativePaidTierEstimator,
      }),
  );
  const evaluators = GEMINI_FREE_MODEL_CHAIN.map(
    (modelId) =>
      new AiSdkSemanticEvaluator({
        model: google(modelId),
        providerId: "google-gemini",
        modelId,
        costEstimator: conservativePaidTierEstimator,
      }),
  );
  return {
    provider: new FallbackGeneratedPostProvider(providers),
    semanticEvaluator: new FallbackSemanticEvaluator(evaluators),
    modelChain: [...GEMINI_FREE_MODEL_CHAIN],
  };
}
