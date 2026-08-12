import type { GeneratedPost, ModelUsage } from "../../contracts";
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

export interface DeterministicFakeGeneratedPostProviderOptions {
  post:
    | GeneratedPost
    | ((request: Readonly<GeneratedPostGenerationRequest>) => unknown);
  metadata: GeneratedPostProviderMetadata;
  usage?: ModelUsage;
  costEstimator?: ModelCostEstimator;
  now?: () => Date;
  createCallId?: (request: Readonly<GeneratedPostGenerationRequest>) => string;
  failWith?: GenerationProviderError;
}

const defaultUsage: ModelUsage = {
  inputTokens: 100,
  outputTokens: 200,
  totalTokens: 300,
};

const defaultNow = () => new Date("2026-01-01T00:00:00.000Z");

export class DeterministicFakeGeneratedPostProvider
  implements GeneratedPostProvider
{
  readonly calls: GeneratedPostGenerationRequest[] = [];
  readonly #post: DeterministicFakeGeneratedPostProviderOptions["post"];
  readonly #metadata: GeneratedPostProviderMetadata;
  readonly #usage: ModelUsage;
  readonly #costEstimator: ModelCostEstimator | undefined;
  readonly #now: () => Date;
  readonly #createCallId: (
    request: Readonly<GeneratedPostGenerationRequest>,
  ) => string;
  readonly #failWith: GenerationProviderError | undefined;

  constructor(
    options: Readonly<DeterministicFakeGeneratedPostProviderOptions>,
  ) {
    this.#post = options.post;
    this.#metadata = validateProviderMetadata(options.metadata);
    this.#usage = parseModelUsage(options.usage ?? defaultUsage);
    this.#costEstimator = options.costEstimator;
    this.#now = options.now ?? defaultNow;
    this.#createCallId =
      options.createCallId ??
      ((request) => `fake-${request.purpose}-${request.attemptNumber}`);
    this.#failWith = options.failWith;
  }

  async generate(
    unsafeRequest: Readonly<GeneratedPostGenerationRequest>,
  ): Promise<GeneratedPostGenerationResult> {
    const request = validateGenerationRequest(unsafeRequest);
    this.calls.push(structuredCloneRequest(request));
    if (this.#failWith) {
      throw this.#failWith;
    }

    const startedAt = this.#now();
    const rawPost =
      typeof this.#post === "function" ? this.#post(request) : this.#post;
    const post = parseGeneratedPost(rawPost);
    const estimatedCostUsd = estimateModelCost(
      this.#costEstimator,
      this.#usage,
      this.#metadata,
    );
    const audit = createModelCallAudit({
      callId: this.#createCallId(request),
      request,
      metadata: this.#metadata,
      startedAt,
      finishedAt: this.#now(),
      usage: this.#usage,
      estimatedCostUsd,
      finishReason: "stop",
      responseId: null,
    });

    return { post, audit };
  }
}

function structuredCloneRequest(
  request: GeneratedPostGenerationRequest,
): GeneratedPostGenerationRequest {
  return {
    ...request,
    evidenceItems: structuredClone(request.evidenceItems),
    revisionReasons: request.revisionReasons
      ? [...request.revisionReasons]
      : request.revisionReasons,
    // AbortSignal is not structured-cloneable on all supported runtimes.
    abortSignal: request.abortSignal,
  };
}
