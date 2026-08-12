import {
  generationBudgetSchema,
  generationUsageSchema,
  modelCallAuditSchema,
  type GenerationBudget,
  type GenerationUsage,
  type ModelCallAudit,
} from "../../contracts";

export const EMPTY_GENERATION_USAGE: GenerationUsage = Object.freeze({
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  hasUnpricedCalls: false,
});

export type GenerationBudgetIssue =
  | "MODEL_CALL_LIMIT"
  | "INPUT_TOKEN_LIMIT"
  | "OUTPUT_TOKEN_LIMIT"
  | "ESTIMATED_COST_LIMIT"
  | "UNPRICED_MODEL_CALL";

export interface GenerationBudgetResult {
  passed: boolean;
  issues: GenerationBudgetIssue[];
}

export function recordModelCall(
  current: Readonly<GenerationUsage>,
  candidateAudit: unknown,
): GenerationUsage {
  const usage = generationUsageSchema.parse(current);
  const audit: ModelCallAudit = modelCallAuditSchema.parse(candidateAudit);

  return generationUsageSchema.parse({
    modelCalls: usage.modelCalls + 1,
    inputTokens: usage.inputTokens + audit.usage.inputTokens,
    outputTokens: usage.outputTokens + audit.usage.outputTokens,
    estimatedCostUsd:
      usage.estimatedCostUsd + (audit.estimatedCostUsd ?? 0),
    hasUnpricedCalls:
      usage.hasUnpricedCalls || audit.estimatedCostUsd === null,
  });
}

/** Records a pessimistic, unpriced call when the provider cannot return usage. */
export function recordFailedModelCall(
  current: Readonly<GenerationUsage>,
  candidateAudit?: unknown,
): GenerationUsage {
  if (candidateAudit !== undefined && candidateAudit !== null) {
    return recordModelCall(current, candidateAudit);
  }

  const usage = generationUsageSchema.parse(current);
  return generationUsageSchema.parse({
    ...usage,
    modelCalls: usage.modelCalls + 1,
    hasUnpricedCalls: true,
  });
}

export function evaluateGenerationBudget(
  candidateUsage: unknown,
  candidateBudget: unknown,
): GenerationBudgetResult {
  const usage = generationUsageSchema.parse(candidateUsage);
  const budget: GenerationBudget = generationBudgetSchema.parse(candidateBudget);
  const issues: GenerationBudgetIssue[] = [];

  if (usage.modelCalls > budget.maxModelCalls) {
    issues.push("MODEL_CALL_LIMIT");
  }
  if (usage.inputTokens > budget.maxInputTokens) {
    issues.push("INPUT_TOKEN_LIMIT");
  }
  if (usage.outputTokens > budget.maxOutputTokens) {
    issues.push("OUTPUT_TOKEN_LIMIT");
  }
  if (usage.estimatedCostUsd > budget.maxEstimatedCostUsd) {
    issues.push("ESTIMATED_COST_LIMIT");
  }
  if (usage.hasUnpricedCalls) {
    issues.push("UNPRICED_MODEL_CALL");
  }

  return { passed: issues.length === 0, issues };
}

export function canStartModelCall(
  candidateUsage: unknown,
  candidateBudget: unknown,
): boolean {
  const usage = generationUsageSchema.parse(candidateUsage);
  const budget = generationBudgetSchema.parse(candidateBudget);
  return usage.modelCalls < budget.maxModelCalls;
}
