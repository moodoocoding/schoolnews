import "server-only";

import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import type { ModelUsage } from "../../contracts";
import {
  AiSdkGeneratedPostProvider,
  FallbackGeneratedPostProvider,
  type GeneratedPostGenerationRequest,
  type GeneratedPostProvider,
  type GeneratedPostProviderMetadata,
  type ModelInvocationReservation,
} from "../../pipeline/generation";
import {
  AiSdkSemanticEvaluator,
  FallbackSemanticEvaluator,
  SEMANTIC_EVALUATOR_PROMPT_VERSION,
  type PostGenerationSemanticEvaluator,
} from "../../pipeline/orchestrator";
import {
  buildGeneratedPostPrompt,
  GENERATED_POST_PROMPT_VERSION,
  GENERATED_POST_SYSTEM_PROMPT,
} from "../../prompts";

export const GEMINI_PROVIDER_ID = "google-gemini";

export const GEMINI_FREE_MODEL_CHAIN = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
] as const;

/**
 * This version is part of the durable generation configuration fingerprint.
 * Change it whenever the upper-bound calculation or paid-tier rates change.
 */
export const GEMINI_RESERVATION_POLICY_VERSION =
  "gemini-conservative-paid-tier-v1";

const PAID_TIER_INPUT_USD_PER_MILLION_TOKENS = 1.5;
const PAID_TIER_OUTPUT_USD_PER_MILLION_TOKENS = 9;
// Covers the generated JSON schema, Output.object tool envelope, provider
// request metadata, and future-compatible framing. The payload itself is then
// reserved at one token per UTF-8 byte, which is already conservative for the
// Korean/JSON text accepted by the bounded application contracts.
const STRUCTURED_OUTPUT_FRAMING_TOKEN_ALLOWANCE = 16_384;

type GeminiModelId = (typeof GEMINI_FREE_MODEL_CHAIN)[number];
type SemanticRequest = Parameters<PostGenerationSemanticEvaluator["evaluate"]>[0];

export interface GeminiRawGeneratedRoute {
  provider: GeneratedPostProvider;
  metadata: GeneratedPostProviderMetadata;
  promptVersion: typeof GENERATED_POST_PROMPT_VERSION;
  reservationPolicyVersion: typeof GEMINI_RESERVATION_POLICY_VERSION;
  reservation(
    request: Readonly<GeneratedPostGenerationRequest>,
  ): ModelInvocationReservation;
}

export interface GeminiRawSemanticRoute {
  evaluator: PostGenerationSemanticEvaluator;
  providerId: typeof GEMINI_PROVIDER_ID;
  modelId: GeminiModelId;
  promptVersion: typeof SEMANTIC_EVALUATOR_PROMPT_VERSION;
  reservationPolicyVersion: typeof GEMINI_RESERVATION_POLICY_VERSION;
  reservation(request: Readonly<SemanticRequest>): ModelInvocationReservation;
}

export interface GeminiRawRoutes {
  generatedRoutes: readonly GeminiRawGeneratedRoute[];
  semanticRoutes: readonly GeminiRawSemanticRoute[];
  modelChain: GeminiModelId[];
}

export type GeminiLanguageModelFactory = (modelId: GeminiModelId) => LanguageModel;

function validateApiKey(apiKey: string): string {
  if (apiKey.trim().length < 20 || /\s/u.test(apiKey)) {
    throw new Error("Google Gemini API 키 설정이 유효하지 않습니다.");
  }
  return apiKey;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function paidTierUpperBound(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * PAID_TIER_INPUT_USD_PER_MILLION_TOKENS +
      outputTokens * PAID_TIER_OUTPUT_USD_PER_MILLION_TOKENS) /
    1_000_000
  );
}

function reservationForPayload(
  payload: string,
  maxOutputTokens: number,
): ModelInvocationReservation {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new TypeError("Gemini 예약 출력 토큰 한도가 유효하지 않습니다.");
  }

  // Gemini can tokenize Korean and JSON more densely than one token per UTF-8
  // byte. Reserving one token per byte plus fixed request framing is therefore
  // deliberately conservative and keeps the database budget authoritative.
  const inputTokens =
    utf8ByteLength(payload) + STRUCTURED_OUTPUT_FRAMING_TOKEN_ALLOWANCE;
  return {
    inputTokens,
    outputTokens: maxOutputTokens,
    costUsd: paidTierUpperBound(inputTokens, maxOutputTokens),
  };
}

export function reserveGeminiGeneratedPostRequest(
  request: Readonly<GeneratedPostGenerationRequest>,
): ModelInvocationReservation {
  // buildGeneratedPostPrompt preserves the same evidence validation and PII
  // gate used by the physical provider; unsafe evidence is rejected before a
  // ledger reservation can authorize a model call.
  const prompt = buildGeneratedPostPrompt(request);
  return reservationForPayload(
    `${GENERATED_POST_SYSTEM_PROMPT}\n${prompt}`,
    request.maxOutputTokens,
  );
}

export function reserveGeminiSemanticReviewRequest(
  request: Readonly<SemanticRequest>,
): ModelInvocationReservation {
  const payload = JSON.stringify({
    post: request.post,
    evidence: request.evidenceItems,
    articleDocuments: request.articleDocuments,
  });
  return reservationForPayload(payload, request.maxOutputTokens);
}

function conservativePaidTierEstimator(usage: Readonly<ModelUsage>): number {
  return paidTierUpperBound(usage.inputTokens, usage.outputTokens);
}

/**
 * Creates one raw provider and evaluator per physical model. It intentionally
 * does not compose fallback. The Supabase factory must wrap every returned
 * route in its ledger boundary before adding the single outer fallback.
 *
 * The injected factory exists for deterministic, zero-network tests and for
 * server-side model adapter composition; it must not be exposed to clients.
 */
export function createGeminiRawRoutesWithModelFactory(
  createModel: GeminiLanguageModelFactory,
): GeminiRawRoutes {
  const generatedRoutes = GEMINI_FREE_MODEL_CHAIN.map((modelId) => {
    const metadata = { providerId: GEMINI_PROVIDER_ID, modelId } as const;
    return {
      provider: new AiSdkGeneratedPostProvider({
        model: createModel(modelId),
        metadata,
        costEstimator: conservativePaidTierEstimator,
      }),
      metadata,
      promptVersion: GENERATED_POST_PROMPT_VERSION,
      reservationPolicyVersion: GEMINI_RESERVATION_POLICY_VERSION,
      reservation: reserveGeminiGeneratedPostRequest,
    } satisfies GeminiRawGeneratedRoute;
  });
  const semanticRoutes = GEMINI_FREE_MODEL_CHAIN.map((modelId) => ({
    evaluator: new AiSdkSemanticEvaluator({
      model: createModel(modelId),
      providerId: GEMINI_PROVIDER_ID,
      modelId,
      costEstimator: conservativePaidTierEstimator,
    }),
    providerId: GEMINI_PROVIDER_ID,
    modelId,
    promptVersion: SEMANTIC_EVALUATOR_PROMPT_VERSION,
    reservationPolicyVersion: GEMINI_RESERVATION_POLICY_VERSION,
    reservation: reserveGeminiSemanticReviewRequest,
  })) satisfies GeminiRawSemanticRoute[];

  return {
    generatedRoutes,
    semanticRoutes,
    modelChain: [...GEMINI_FREE_MODEL_CHAIN],
  };
}

export function createGeminiRawRoutes(input: { apiKey: string }): GeminiRawRoutes {
  const google = createGoogle({ apiKey: validateApiKey(input.apiKey) });
  return createGeminiRawRoutesWithModelFactory((modelId) => google(modelId));
}

/**
 * Backward-compatible factory for the memory path. Supabase must use raw
 * routes instead so each physical route is ledgered before fallback.
 */
export function createGeminiGeneration(input: { apiKey: string }) {
  const raw = createGeminiRawRoutes(input);
  return {
    provider: new FallbackGeneratedPostProvider(
      raw.generatedRoutes.map((route) => route.provider),
    ),
    semanticEvaluator: new FallbackSemanticEvaluator(
      raw.semanticRoutes.map((route) => route.evaluator),
    ),
    modelChain: [...raw.modelChain],
  };
}
