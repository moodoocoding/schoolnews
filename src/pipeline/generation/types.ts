import type {
  EvidenceItem,
  GeneratedPost,
  GenerationPurpose,
  ModelCallAudit,
  ModelUsage,
} from "../../contracts";

export interface GeneratedPostGenerationRequest {
  attemptNumber: 1 | 2;
  purpose: GenerationPurpose;
  evidenceItems: readonly EvidenceItem[];
  revisionReasons?: readonly string[] | null;
  timeoutMs: number;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
}

export interface GeneratedPostGenerationResult {
  post: GeneratedPost;
  audit: ModelCallAudit;
}

export interface GeneratedPostProvider {
  generate(
    request: Readonly<GeneratedPostGenerationRequest>,
  ): Promise<GeneratedPostGenerationResult>;
}

export interface GeneratedPostProviderMetadata {
  providerId: string;
  modelId: string;
}

export type ModelCostEstimator = (
  usage: Readonly<ModelUsage>,
  metadata: Readonly<GeneratedPostProviderMetadata>,
) => number;
