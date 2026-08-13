import type { ModelCallAudit } from "../../contracts";
import { GenerationProviderError } from "./errors";
import type {
  GeneratedPostGenerationRequest,
  GeneratedPostGenerationResult,
  GeneratedPostProvider,
} from "./types";

const FALLBACK_CODES = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_MODEL_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
]);

export class FallbackGeneratedPostProvider implements GeneratedPostProvider {
  readonly #providers: readonly GeneratedPostProvider[];

  constructor(providers: readonly GeneratedPostProvider[]) {
    if (providers.length < 1) {
      throw new GenerationProviderError("INVALID_PROVIDER_CONFIGURATION");
    }
    this.#providers = [...providers];
  }

  async generate(
    request: Readonly<GeneratedPostGenerationRequest>,
  ): Promise<GeneratedPostGenerationResult> {
    const audits: ModelCallAudit[] = [];

    const allowedProviders = this.#providers.slice(
      0,
      request.maxPhysicalCalls ?? 1,
    );
    for (const [index, provider] of allowedProviders.entries()) {
      try {
        const result = await provider.generate(request);
        const providerAudits = (result.audits ?? [result.audit]).map(
          (audit) => ({ ...audit, routeAttempt: index + 1 }),
        );
        return {
          post: result.post,
          audit: { ...result.audit, routeAttempt: index + 1 },
          audits: [...audits, ...providerAudits],
        };
      } catch (error) {
        if (!(error instanceof GenerationProviderError)) {
          throw error;
        }
        audits.push(
          ...error.audits.map((audit) => ({
            ...audit,
            routeAttempt: index + 1,
          })),
        );
        const canFallback =
          FALLBACK_CODES.has(error.code) && index < allowedProviders.length - 1;
        if (!canFallback) {
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
