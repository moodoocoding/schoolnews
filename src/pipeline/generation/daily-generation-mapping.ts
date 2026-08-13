import {
  generatedPostSchema,
  generationUsageSchema,
  type GeneratedPost,
  type GenerationUsage,
} from "../../contracts";
import type { GenerationProviderErrorCode } from "./errors";

export type DailyGenerationFailureCode =
  | "MODEL_PROVIDER_ERROR"
  | "BUDGET_EXCEEDED"
  | "QUALITY_REJECTED";

/**
 * The minimum generation result shape needed by the daily pipeline bridge.
 *
 * This deliberately does not expose model audits, prompts, evidence, or post
 * body fields that the orchestration layer does not need for its decision.
 * `PostGenerationResult` is structurally assignable to this type without
 * importing the orchestrator back into the generation package.
 */
export interface DailyGenerationSourceResult {
  status: "validated" | "withheld";
  post: GeneratedPost | null;
  qualityResult: { passed: boolean } | null;
  usage: GenerationUsage;
  failureCode: DailyGenerationFailureCode | null;
  providerErrorCode: GenerationProviderErrorCode | null;
}

export type DailyGenerationMapping =
  | {
      disposition: "ready";
      post: GeneratedPost;
      usage: GenerationUsage;
    }
  | {
      disposition: "withheld";
      reason: "QUALITY_REJECTED";
      post: null;
      usage: GenerationUsage;
    }
  | {
      disposition: "blocked";
      reason: "BUDGET_EXCEEDED";
      post: null;
      usage: GenerationUsage;
    }
  | {
      disposition: "failed";
      errorCode: "MODEL_PROVIDER_ERROR" | "INVALID_SOURCE_DATA";
      retryable: boolean;
      post: null;
      usage: GenerationUsage;
    };

const RETRYABLE_PROVIDER_ERRORS = new Set<GenerationProviderErrorCode>([
  "PROVIDER_TIMEOUT",
  "PROVIDER_REQUEST_FAILED",
  "PROVIDER_UNAVAILABLE",
]);

function invalidSource(usage: GenerationUsage): DailyGenerationMapping {
  return {
    disposition: "failed",
    errorCode: "INVALID_SOURCE_DATA",
    retryable: false,
    post: null,
    usage,
  };
}

/**
 * Converts a generation result into a publication-safe daily-stage decision.
 * The returned usage is schema-validated and copied without rounding or
 * dropping the unpriced-call flag.
 */
export function mapPostGenerationForDailyStage(
  source: Readonly<DailyGenerationSourceResult>,
): DailyGenerationMapping {
  const usage = generationUsageSchema.parse(source.usage);

  if (source.status === "validated") {
    if (
      source.failureCode !== null ||
      source.providerErrorCode !== null ||
      source.qualityResult?.passed !== true ||
      source.post === null
    ) {
      return invalidSource(usage);
    }

    const post = generatedPostSchema.safeParse(source.post);
    return post.success
      ? { disposition: "ready", post: post.data, usage }
      : invalidSource(usage);
  }

  if (source.post !== null) {
    return invalidSource(usage);
  }

  switch (source.failureCode) {
    case "QUALITY_REJECTED":
      return source.providerErrorCode === null &&
        source.qualityResult?.passed === false
        ? {
            disposition: "withheld",
            reason: "QUALITY_REJECTED",
            post: null,
            usage,
          }
        : invalidSource(usage);
    case "BUDGET_EXCEEDED":
      return source.providerErrorCode === null
        ? {
            disposition: "blocked",
            reason: "BUDGET_EXCEEDED",
            post: null,
            usage,
          }
        : invalidSource(usage);
    case "MODEL_PROVIDER_ERROR":
      return {
        disposition: "failed",
        errorCode: "MODEL_PROVIDER_ERROR",
        retryable:
          source.providerErrorCode !== null &&
          RETRYABLE_PROVIDER_ERRORS.has(source.providerErrorCode),
        post: null,
        usage,
      };
    case null:
      return invalidSource(usage);
  }
}
