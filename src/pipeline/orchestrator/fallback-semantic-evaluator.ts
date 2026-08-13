import type { ModelCallAudit } from "../../contracts";
import { GenerationProviderError } from "../generation";
import type {
  PostGenerationSemanticEvaluationResult,
  PostGenerationSemanticEvaluator,
} from "./run-post-generation";

const FALLBACK_CODES = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_MODEL_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
]);

export class FallbackSemanticEvaluator
  implements PostGenerationSemanticEvaluator
{
  readonly #evaluators: readonly PostGenerationSemanticEvaluator[];

  constructor(evaluators: readonly PostGenerationSemanticEvaluator[]) {
    if (evaluators.length < 1)
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    this.#evaluators = [...evaluators];
  }

  async evaluate(
    input: Parameters<PostGenerationSemanticEvaluator["evaluate"]>[0],
  ): Promise<PostGenerationSemanticEvaluationResult> {
    const audits: ModelCallAudit[] = [];
    const allowedEvaluators = this.#evaluators.slice(
      0,
      input.maxPhysicalCalls ?? 1,
    );
    for (const [index, evaluator] of allowedEvaluators.entries()) {
      try {
        const result = await evaluator.evaluate(input);
        return {
          review: result.review,
          audit: { ...result.audit, routeAttempt: index + 1 },
          audits: [
            ...audits,
            ...(result.audits ?? [result.audit]).map((audit) => ({
              ...audit,
              routeAttempt: index + 1,
            })),
          ],
        };
      } catch (error) {
        if (!(error instanceof GenerationProviderError)) throw error;
        audits.push(
          ...error.audits.map((audit) => ({
            ...audit,
            routeAttempt: index + 1,
          })),
        );
        if (
          !FALLBACK_CODES.has(error.code) ||
          index === allowedEvaluators.length - 1
        ) {
          throw new GenerationProviderError(error.code, {
            cause: error,
            audit: error.audit,
            audits,
          });
        }
      }
    }
    throw new GenerationProviderError("PROVIDER_REQUEST_FAILED", { audits });
  }
}
