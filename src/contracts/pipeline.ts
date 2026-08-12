import { z } from "zod";

import {
  identifierSchema,
  isoTimestampSchema,
  publicationDateKstSchema,
  sha256Schema,
} from "./common";

export const pipelineStageSchema = z.enum([
  "collect",
  "normalize",
  "deduplicate",
  "score",
  "retrieve",
  "generate",
  "validate",
  "publish",
  "cache_refresh",
]);

export const pipelineStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "failed_retryable",
  "skipped",
]);

export const pipelineRunStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "succeeded_without_publish",
  "published_with_warning",
  "failed",
  "blocked",
]);

export const pipelineErrorCodeSchema = z.enum([
  "NO_ELIGIBLE_TOPIC",
  "SOURCE_UNAVAILABLE",
  "COLLECTION_TIMEOUT",
  "STAGE_TIMEOUT",
  "RUN_DEADLINE_EXCEEDED",
  "RUN_ABORTED",
  "INVALID_SOURCE_DATA",
  "LEASE_UNAVAILABLE",
  "LEASE_EXPIRED",
  "DUPLICATE_PUBLICATION_DATE",
  "PUBLISH_TIMEOUT_AMBIGUOUS",
  "PIPELINE_VERSION_MISMATCH",
  "QUALITY_REJECTED",
  "MODEL_PROVIDER_ERROR",
  "BUDGET_EXCEEDED",
  "CACHE_REFRESH_FAILED",
  "UNKNOWN_ERROR",
]);

export const pipelineStepStateSchema = z
  .object({
    stage: pipelineStageSchema,
    status: pipelineStepStatusSchema,
    attemptNumber: z.number().int().min(0),
    inputFingerprint: sha256Schema.nullable(),
    outputReference: z.string().trim().min(1).max(500).nullable(),
    startedAt: isoTimestampSchema.nullable(),
    finishedAt: isoTimestampSchema.nullable(),
    errorCode: pipelineErrorCodeSchema.nullable(),
  })
  .strict();

export const pipelineRunStateSchema = z
  .object({
    runId: identifierSchema,
    runDate: publicationDateKstSchema,
    status: pipelineRunStatusSchema,
    pipelineVersion: z.string().trim().min(1).max(64),
    currentStage: pipelineStageSchema.nullable(),
    steps: z.array(pipelineStepStateSchema).min(1),
    limits: z
      .object({
        maxModelCalls: z.number().int().min(1),
        maxInputTokens: z.number().int().min(1),
        maxOutputTokens: z.number().int().min(1),
        maxEstimatedCostUsd: z.number().min(0),
        maxRunSeconds: z.number().int().min(1),
      })
      .strict(),
    usage: z
      .object({
        modelCalls: z.number().int().min(0),
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
        estimatedCostUsd: z.number().min(0),
        hasUnpricedCalls: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((run, context) => {
    const stages = run.steps.map((step) => step.stage);
    const duplicateStages = stages.filter(
      (stage, index) => stages.indexOf(stage) !== index,
    );
    if (duplicateStages.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "실행 상태에는 단계별 최신 상태가 하나씩만 있어야 합니다.",
      });
    }
    if (
      stages.some(
        (stage, index) =>
          index > 0 &&
          pipelineStageSchema.options.indexOf(stages[index - 1]) >=
            pipelineStageSchema.options.indexOf(stage),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "실행 단계는 표준 파이프라인 순서여야 합니다.",
      });
    }

    run.steps.forEach((step, index) => {
      if (step.status === "running" && step.startedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "startedAt"],
          message: "실행 중 단계에는 시작 시각이 필요합니다.",
        });
      }
      if (
        ["succeeded", "failed", "failed_retryable"].includes(
          step.status,
        ) &&
        (step.startedAt === null || step.finishedAt === null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["steps", index],
          message: "실행된 단계에는 시작과 종료 시각이 필요합니다.",
        });
      }
      if (step.status === "skipped" && step.finishedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "finishedAt"],
          message: "생략된 단계에는 종료 시각이 필요합니다.",
        });
      }
      if (
        ["succeeded", "skipped"].includes(step.status) &&
        step.errorCode !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "errorCode"],
          message: "성공 또는 생략 단계에는 오류 코드가 있을 수 없습니다.",
        });
      }
      if (
        ["failed", "failed_retryable"].includes(step.status) &&
        step.errorCode === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "errorCode"],
          message: "실패 단계에는 오류 코드가 필요합니다.",
        });
      }
    });

    if (
      run.steps.filter((step) => step.status === "running").length > 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "동시에 실행 중인 단계는 하나만 허용됩니다.",
      });
    }

    if (run.currentStage !== null) {
      const current = run.steps.find((step) => step.stage === run.currentStage);
      if (!current || !["pending", "running", "failed_retryable"].includes(current.status)) {
        context.addIssue({
          code: "custom",
          path: ["currentStage"],
          message: "현재 단계는 재개 가능하거나 실행 중인 단계와 일치해야 합니다.",
        });
      }
    }

    if (
      ["succeeded", "succeeded_without_publish"].includes(run.status) &&
      run.steps.some((step) =>
        ["failed", "failed_retryable", "running"].includes(step.status),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "성공한 실행에는 실패 또는 실행 중 단계가 있을 수 없습니다.",
      });
    }

    const terminal = [
      "succeeded",
      "succeeded_without_publish",
      "published_with_warning",
      "failed",
      "blocked",
    ].includes(run.status);
    if (
      terminal &&
      run.steps.some((step) =>
        ["pending", "running", "failed_retryable"].includes(step.status),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "종료된 실행에는 미완료 단계가 있을 수 없습니다.",
      });
    }
    const publishStep = run.steps.find((step) => step.stage === "publish");
    if (
      ["succeeded", "published_with_warning"].includes(run.status) &&
      publishStep?.status !== "succeeded"
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "발행 성공 상태에는 성공한 publish 단계가 필요합니다.",
      });
    }
    if (
      run.status === "succeeded_without_publish" &&
      publishStep?.status === "succeeded"
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "미발행 성공 상태에는 성공한 publish 단계가 있을 수 없습니다.",
      });
    }

    const limitsExceeded =
      run.usage.modelCalls > run.limits.maxModelCalls ||
      run.usage.inputTokens > run.limits.maxInputTokens ||
      run.usage.outputTokens > run.limits.maxOutputTokens ||
      run.usage.estimatedCostUsd > run.limits.maxEstimatedCostUsd ||
      run.usage.hasUnpricedCalls;
    if (
      limitsExceeded &&
      run.status !== "blocked" &&
      run.status !== "running"
    ) {
      context.addIssue({
        code: "custom",
        path: ["usage"],
        message: "실행 한도를 넘은 상태는 blocked여야 합니다.",
      });
    }
  });

export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type PipelineErrorCode = z.infer<typeof pipelineErrorCodeSchema>;
export type PipelineStepState = z.infer<typeof pipelineStepStateSchema>;
export type PipelineRunState = z.infer<typeof pipelineRunStateSchema>;
