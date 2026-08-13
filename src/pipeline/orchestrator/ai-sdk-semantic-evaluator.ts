import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
} from "ai";

import {
  articleModelDocumentSchema,
  generatedPostSchema,
  modelCallAuditSchema,
  semanticReviewSchema,
  type ModelCallAudit,
} from "../../contracts";
import { GenerationProviderError } from "../generation";
import {
  estimateModelCost,
  parseModelUsage,
} from "../generation/generation-support";
import type { ModelCostEstimator } from "../generation";
import type {
  PostGenerationSemanticEvaluationResult,
  PostGenerationSemanticEvaluator,
} from "./run-post-generation";

export const SEMANTIC_EVALUATOR_PROMPT_VERSION = "semantic-evaluator-v1";

export interface AiSdkSemanticEvaluatorOptions {
  model: LanguageModel;
  providerId: string;
  modelId: string;
  now?: () => Date;
  createCallId?: () => string;
  costEstimator?: ModelCostEstimator;
}

export class AiSdkSemanticEvaluator
  implements PostGenerationSemanticEvaluator
{
  readonly #options: AiSdkSemanticEvaluatorOptions;

  constructor(options: AiSdkSemanticEvaluatorOptions) {
    if (!options.providerId || !options.modelId) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    this.#options = options;
  }

  async evaluate(
    input: Parameters<PostGenerationSemanticEvaluator["evaluate"]>[0],
  ): Promise<PostGenerationSemanticEvaluationResult> {
    generatedPostSchema.parse(input.post);
    const articleDocuments = (input.articleDocuments ?? []).map((document) =>
      articleModelDocumentSchema.parse(document),
    );
    if (articleDocuments.length === 0) {
      throw new GenerationProviderError("INVALID_GENERATION_INPUT");
    }
    const now = this.#options.now ?? (() => new Date());
    const startedAt = now();
    const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
    const abortSignal = input.abortSignal
      ? AbortSignal.any([input.abortSignal, timeoutSignal])
      : timeoutSignal;
    const callId =
      this.#options.createCallId?.() ?? `semantic-${crypto.randomUUID()}`;

    const makeAudit = (values: {
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
      finishReason: string | null;
      responseId: string | null;
    }): ModelCallAudit =>
      modelCallAuditSchema.parse({
        callId,
        attemptNumber: input.attemptNumber,
        purpose: "semantic_review",
        providerId: this.#options.providerId,
        modelId: this.#options.modelId,
        promptVersion: SEMANTIC_EVALUATOR_PROMPT_VERSION,
        startedAt: startedAt.toISOString(),
        finishedAt: now().toISOString(),
        evidenceIds: input.evidenceItems.map((item) => item.evidenceId),
        usage: values.usage,
        estimatedCostUsd:
          values.usage.totalTokens === 0
            ? 0
            : estimateModelCost(
                this.#options.costEstimator,
                values.usage,
                {
                  providerId: this.#options.providerId,
                  modelId: this.#options.modelId,
                },
              ),
        finishReason: values.finishReason,
        responseId: values.responseId,
      });

    try {
      const result = await generateText({
        model: this.#options.model,
        instructions:
          "제공된 근거와 게시물의 의미 일치만 심사하세요. 외부 지식을 추가하지 말고, 근거 없는 주장·모순·인과 과장·홍보 표현을 보수적으로 표시하세요.",
        prompt: JSON.stringify({
          post: input.post,
          evidence: input.evidenceItems,
          articleDocuments: articleDocuments.map((document) => ({
            documentId: document.documentId,
            evidenceId: document.evidenceId,
            sourceName: document.sourceName,
            title: document.title,
            publishedAt: document.publishedAt,
            contentText: document.contentText,
          })),
        }),
        output: Output.object({ schema: semanticReviewSchema }),
        maxOutputTokens: input.maxOutputTokens,
        maxRetries: 0,
        abortSignal,
      });
      const usage = parseModelUsage(result.usage);
      const audit = makeAudit({
        usage,
        finishReason: result.finishReason ?? null,
        responseId: result.response.id ?? null,
      });
      return { review: semanticReviewSchema.parse(result.output), audit };
    } catch (error) {
      if (timeoutSignal.aborted)
        throw new GenerationProviderError("PROVIDER_TIMEOUT", { cause: error });
      if (input.abortSignal?.aborted)
        throw new GenerationProviderError("PROVIDER_ABORTED", { cause: error });
      if (NoObjectGeneratedError.isInstance(error)) {
        let audit: ModelCallAudit | null = null;
        if (error.usage) {
          try {
            const usage = parseModelUsage(error.usage);
            audit = makeAudit({
              usage,
              finishReason: error.finishReason ?? null,
              responseId: error.response?.id ?? null,
            });
          } catch {
            audit = null;
          }
        }
        throw new GenerationProviderError("INVALID_MODEL_OUTPUT", {
          cause: error,
          audit,
        });
      }
      if (NoOutputGeneratedError.isInstance(error)) {
        throw new GenerationProviderError("INVALID_MODEL_OUTPUT", {
          cause: error,
        });
      }
      if (APICallError.isInstance(error)) {
        const googleStatus =
          typeof error.data === "object" &&
          error.data !== null &&
          "error" in error.data &&
          typeof error.data.error === "object" &&
          error.data.error !== null &&
          "status" in error.data.error &&
          typeof error.data.error.status === "string"
            ? error.data.error.status
            : null;
        const exactModelEndpoint = error.url.includes(
          `/models/${this.#options.modelId}:generateContent`,
        );
        const code =
          error.statusCode === 429 && googleStatus === "RESOURCE_EXHAUSTED"
            ? "PROVIDER_RATE_LIMITED"
            : error.statusCode === 404 &&
                googleStatus === "NOT_FOUND" &&
                exactModelEndpoint
              ? "PROVIDER_MODEL_UNAVAILABLE"
              : error.statusCode === 503 && googleStatus === "UNAVAILABLE"
                ? "PROVIDER_UNAVAILABLE"
                : "PROVIDER_REQUEST_FAILED";
        const audit = makeAudit({
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          finishReason: code.toLowerCase(),
          responseId: null,
        });
        throw new GenerationProviderError(code, { cause: error, audit });
      }
      throw new GenerationProviderError("PROVIDER_REQUEST_FAILED", {
        cause: error,
      });
    }
  }
}
