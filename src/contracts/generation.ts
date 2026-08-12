import { z } from "zod";

import { identifierSchema, isoTimestampSchema } from "./common";

export const generationPurposeSchema = z.enum(["draft", "revision"]);
export const modelCallPurposeSchema = z.enum([
  "draft",
  "revision",
  "semantic_review",
]);

export const modelUsageSchema = z
  .object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.totalTokens < usage.inputTokens + usage.outputTokens) {
      context.addIssue({
        code: "custom",
        path: ["totalTokens"],
        message: "전체 토큰 수는 입력과 출력 토큰 수의 합보다 작을 수 없습니다.",
      });
    }
  });

export const modelCallAuditSchema = z
  .object({
    callId: identifierSchema,
    attemptNumber: z.number().int().min(1).max(2),
    purpose: modelCallPurposeSchema,
    providerId: identifierSchema,
    modelId: z.string().trim().min(1).max(160),
    promptVersion: z.string().trim().min(1).max(64),
    startedAt: isoTimestampSchema,
    finishedAt: isoTimestampSchema,
    evidenceIds: z.array(identifierSchema).min(1),
    usage: modelUsageSchema,
    estimatedCostUsd: z.number().min(0).nullable(),
    finishReason: z.string().trim().min(1).max(80).nullable(),
    responseId: z.string().trim().min(1).max(256).nullable(),
  })
  .strict()
  .superRefine((audit, context) => {
    if (new Date(audit.finishedAt) < new Date(audit.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "모델 호출 종료 시각은 시작 시각보다 빠를 수 없습니다.",
      });
    }

    if (new Set(audit.evidenceIds).size !== audit.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "모델 호출 근거 ID는 중복될 수 없습니다.",
      });
    }
  });

export const generationBudgetSchema = z
  .object({
    maxModelCalls: z.number().int().min(1).max(4),
    maxInputTokens: z.number().int().min(1),
    maxOutputTokens: z.number().int().min(1),
    maxEstimatedCostUsd: z.number().min(0),
    maxCallSeconds: z.number().int().min(1).max(300),
  })
  .strict();

export const generationUsageSchema = z
  .object({
    modelCalls: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    estimatedCostUsd: z.number().min(0),
    hasUnpricedCalls: z.boolean(),
  })
  .strict();

export const semanticFindingCodeSchema = z.enum([
  "UNSUPPORTED_CLAIM",
  "CONTRADICTED_CLAIM",
  "CAUSAL_OVERREACH",
  "DUPLICATE_TOPIC",
  "PROMOTIONAL_LANGUAGE",
  "SOURCE_CONFLICT",
]);

export const semanticFindingSchema = z
  .object({
    code: semanticFindingCodeSchema,
    message: z.string().trim().min(1).max(500),
    claimIds: z.array(identifierSchema),
    evidenceIds: z.array(identifierSchema),
  })
  .strict()
  .superRefine((finding, context) => {
    if (new Set(finding.claimIds).size !== finding.claimIds.length) {
      context.addIssue({
        code: "custom",
        path: ["claimIds"],
        message: "의미 검사 주장 ID는 중복될 수 없습니다.",
      });
    }
    if (new Set(finding.evidenceIds).size !== finding.evidenceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "의미 검사 근거 ID는 중복될 수 없습니다.",
      });
    }
  });

export const semanticReviewSchema = z
  .object({
    passed: z.boolean(),
    evaluatorVersion: z.string().trim().min(1).max(64),
    findings: z.array(semanticFindingSchema),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.passed !== (review.findings.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["passed"],
        message: "의미 검사 통과 여부와 발견 항목 유무가 일치해야 합니다.",
      });
    }
  });

export type GenerationPurpose = z.infer<typeof generationPurposeSchema>;
export type ModelCallPurpose = z.infer<typeof modelCallPurposeSchema>;
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type ModelCallAudit = z.infer<typeof modelCallAuditSchema>;
export type GenerationBudget = z.infer<typeof generationBudgetSchema>;
export type GenerationUsage = z.infer<typeof generationUsageSchema>;
export type SemanticFinding = z.infer<typeof semanticFindingSchema>;
export type SemanticReview = z.infer<typeof semanticReviewSchema>;
