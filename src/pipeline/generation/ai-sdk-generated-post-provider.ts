import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
} from "ai";

import { generatedPostSchema } from "../../contracts";
import type { ModelCallAudit } from "../../contracts";
import {
  buildGeneratedPostPrompt,
  GENERATED_POST_SYSTEM_PROMPT,
} from "../../prompts/generated-post-v2";
import { GenerationProviderError } from "./errors";
import {
  createModelCallAudit,
  estimateModelCost,
  parseGeneratedPost,
  parseModelUsage,
  validateGenerationRequest,
  validateProviderMetadata,
} from "./generation-support";
import type {
  GeneratedPostGenerationRequest,
  GeneratedPostGenerationResult,
  GeneratedPostProvider,
  GeneratedPostProviderMetadata,
  ModelCostEstimator,
} from "./types";

export interface AiSdkGeneratedPostProviderOptions {
  model: LanguageModel;
  metadata: GeneratedPostProviderMetadata;
  costEstimator?: ModelCostEstimator;
  now?: () => Date;
  createCallId?: (request: Readonly<GeneratedPostGenerationRequest>) => string;
}

export class AiSdkGeneratedPostProvider implements GeneratedPostProvider {
  readonly #model: LanguageModel;
  readonly #metadata: GeneratedPostProviderMetadata;
  readonly #costEstimator: ModelCostEstimator | undefined;
  readonly #now: () => Date;
  readonly #createCallId: (
    request: Readonly<GeneratedPostGenerationRequest>,
  ) => string;

  constructor(options: Readonly<AiSdkGeneratedPostProviderOptions>) {
    this.#model = options.model;
    this.#metadata = validateProviderMetadata(options.metadata);
    this.#costEstimator = options.costEstimator;
    this.#now = options.now ?? (() => new Date());
    this.#createCallId =
      options.createCallId ??
      ((request) =>
        `generation-${request.purpose}-${request.attemptNumber}-${crypto.randomUUID()}`);
  }

  async generate(
    unsafeRequest: Readonly<GeneratedPostGenerationRequest>,
  ): Promise<GeneratedPostGenerationResult> {
    const request = validateGenerationRequest(unsafeRequest);
    const startedAt = this.#now();
    const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
    const abortSignal = request.abortSignal
      ? AbortSignal.any([request.abortSignal, timeoutSignal])
      : timeoutSignal;
    let completedAudit: ModelCallAudit | null = null;

    try {
      const result = await generateText({
        model: this.#model,
        instructions: GENERATED_POST_SYSTEM_PROMPT,
        prompt: buildGeneratedPostPrompt(request),
        output: Output.object({
          schema: generatedPostSchema,
          name: "generated_post",
          description: "초등교육 AI·디지털 데일리 뉴스 게시물",
        }),
        maxOutputTokens: request.maxOutputTokens,
        maxRetries: 0,
        abortSignal,
      });

      const usage = parseModelUsage(result.usage);
      const estimatedCostUsd = estimateModelCost(
        this.#costEstimator,
        usage,
        this.#metadata,
      );
      completedAudit = createModelCallAudit({
        callId: this.#createCallId(request),
        request,
        metadata: this.#metadata,
        startedAt,
        finishedAt: this.#now(),
        usage,
        estimatedCostUsd,
        finishReason: result.finishReason ?? null,
        responseId: result.response.id ?? null,
      });
      // Output.object validates already; the explicit second parse keeps the
      // provider boundary fail-closed if an SDK adapter ever bypasses it.
      // Audit is deliberately built first because accessing result.output can
      // throw after a billable model response has already been received.
      const post = parseGeneratedPost(result.output);

      return { post, audit: completedAudit };
    } catch (error) {
      if (error instanceof GenerationProviderError) {
        if (completedAudit && !error.audit) {
          throw new GenerationProviderError(error.code, {
            cause: error,
            audit: completedAudit,
          });
        }
        throw error;
      }
      if (timeoutSignal.aborted) {
        throw new GenerationProviderError("PROVIDER_TIMEOUT", { cause: error });
      }
      if (request.abortSignal?.aborted) {
        throw new GenerationProviderError("PROVIDER_ABORTED", { cause: error });
      }
      if (NoObjectGeneratedError.isInstance(error)) {
        let errorAudit = completedAudit;
        if (!errorAudit && error.usage) {
          try {
            const usage = parseModelUsage(error.usage);
            errorAudit = createModelCallAudit({
              callId: this.#createCallId(request),
              request,
              metadata: this.#metadata,
              startedAt,
              finishedAt: this.#now(),
              usage,
              estimatedCostUsd: estimateModelCost(
                this.#costEstimator,
                usage,
                this.#metadata,
              ),
              finishReason: error.finishReason ?? null,
              responseId: error.response?.id ?? null,
            });
          } catch {
            errorAudit = null;
          }
        }
        throw new GenerationProviderError("INVALID_MODEL_OUTPUT", {
          cause: error,
          audit: errorAudit,
        });
      }
      if (NoOutputGeneratedError.isInstance(error)) {
        throw new GenerationProviderError("INVALID_MODEL_OUTPUT", {
          cause: error,
        });
      }
      throw new GenerationProviderError("PROVIDER_REQUEST_FAILED", {
        cause: error,
      });
    }
  }
}
