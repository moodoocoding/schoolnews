import { z } from "zod";

import {
  identifierSchema,
  isoTimestampSchema,
  publicationDateKstSchema,
  sha256Schema,
} from "./common";
import {
  pipelineErrorCodeSchema,
  pipelineRunStateSchema,
  pipelineStageSchema,
} from "./pipeline";

export const dailyRunAttemptStatusSchema = z.enum(["succeeded", "failed"]);

export const dailyRunAttemptSchema = z
  .object({
    stage: pipelineStageSchema,
    attemptNumber: z.number().int().min(1),
    status: dailyRunAttemptStatusSchema,
    inputFingerprint: sha256Schema.nullable(),
    outputReference: z.string().trim().min(1).max(500).nullable(),
    startedAt: isoTimestampSchema,
    finishedAt: isoTimestampSchema,
    errorCode: pipelineErrorCodeSchema.nullable(),
    retryable: z.boolean(),
    retryDelayMs: z.number().int().min(0),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (new Date(attempt.finishedAt) < new Date(attempt.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "단계 시도 종료 시각은 시작 시각보다 빠를 수 없습니다.",
      });
    }
    if (attempt.status === "succeeded" && attempt.errorCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "성공한 단계 시도에는 오류 코드가 있을 수 없습니다.",
      });
    }
    if (attempt.status === "failed" && attempt.errorCode === null) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "실패한 단계 시도에는 오류 코드가 필요합니다.",
      });
    }
    if (!attempt.retryable && attempt.retryDelayMs !== 0) {
      context.addIssue({
        code: "custom",
        path: ["retryDelayMs"],
        message: "재시도하지 않는 시도에는 대기 시간이 있을 수 없습니다.",
      });
    }
  });

export const dailyRunJournalSchema = z
  .object({
    schemaVersion: z.literal("daily-run-v1"),
    revision: z.number().int().min(0),
    run: pipelineRunStateSchema,
    attempts: z.array(dailyRunAttemptSchema),
    terminalReason: pipelineErrorCodeSchema.nullable(),
    startedAt: isoTimestampSchema,
    finishedAt: isoTimestampSchema.nullable(),
    updatedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((journal, context) => {
    const terminalStatuses = new Set([
      "succeeded",
      "succeeded_without_publish",
      "published_with_warning",
      "failed",
      "blocked",
    ]);
    const terminal = terminalStatuses.has(journal.run.status);
    if (terminal !== (journal.finishedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "종료 상태와 실행 종료 시각이 일치해야 합니다.",
      });
    }
    if (!terminal && journal.terminalReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["terminalReason"],
        message: "실행 중 저널에는 종료 사유가 있을 수 없습니다.",
      });
    }
    if (
      ["failed", "blocked", "published_with_warning"].includes(
        journal.run.status,
      ) &&
      journal.terminalReason === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["terminalReason"],
        message: "실패·차단·경고 종료에는 종료 사유가 필요합니다.",
      });
    }
    if (
      journal.run.status === "succeeded" &&
      journal.terminalReason !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["terminalReason"],
        message: "성공 종료에는 오류 사유가 있을 수 없습니다.",
      });
    }
    if (
      journal.run.status === "succeeded_without_publish" &&
      journal.terminalReason !== null &&
      !["NO_ELIGIBLE_TOPIC", "QUALITY_REJECTED"].includes(
        journal.terminalReason,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["terminalReason"],
        message: "미발행 성공은 후보 없음 또는 품질 보류만 사유로 허용합니다.",
      });
    }
    if (terminal && journal.run.currentStage !== null) {
      context.addIssue({
        code: "custom",
        path: ["run", "currentStage"],
        message: "종료된 실행에는 현재 단계가 있을 수 없습니다.",
      });
    }
    const attemptKeys = journal.attempts.map(
      (attempt) => `${attempt.stage}:${attempt.attemptNumber}`,
    );
    if (new Set(attemptKeys).size !== attemptKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "단계와 시도 번호의 조합은 중복될 수 없습니다.",
      });
    }

    for (const stage of pipelineStageSchema.options) {
      const numbers = journal.attempts
        .filter((attempt) => attempt.stage === stage)
        .map((attempt) => attempt.attemptNumber)
        .sort((left, right) => left - right);
      if (numbers.some((number, index) => number !== index + 1)) {
        context.addIssue({
          code: "custom",
          path: ["attempts"],
          message: `${stage} 단계 시도 번호는 1부터 연속되어야 합니다.`,
        });
      }
    }

    const latestAttemptByStage = new Map<string, number>();
    for (const attempt of journal.attempts) {
      latestAttemptByStage.set(
        attempt.stage,
        Math.max(
          latestAttemptByStage.get(attempt.stage) ?? 0,
          attempt.attemptNumber,
        ),
      );
    }
    journal.run.steps.forEach((step, index) => {
      const latest = latestAttemptByStage.get(step.stage) ?? 0;
      if (step.attemptNumber < latest) {
        context.addIssue({
          code: "custom",
          path: ["run", "steps", index, "attemptNumber"],
          message: "최신 단계 상태가 시도 저널보다 과거일 수 없습니다.",
        });
      }
    });
  });

export const dailyRunLeaseSchema = z
  .object({
    runDate: publicationDateKstSchema,
    runId: identifierSchema,
    ownerId: identifierSchema,
    leaseToken: identifierSchema,
    fence: z.number().int().min(1),
    acquiredAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((lease, context) => {
    if (new Date(lease.expiresAt) <= new Date(lease.acquiredAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "임대 만료 시각은 획득 시각보다 뒤여야 합니다.",
      });
    }
  });

export const dailyRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(5),
    initialDelayMs: z.number().int().min(0).max(300_000),
    multiplier: z.number().min(1).max(10),
    maxDelayMs: z.number().int().min(0).max(900_000),
    timeoutMs: z.number().int().min(1).max(900_000),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.maxDelayMs < policy.initialDelayMs) {
      context.addIssue({
        code: "custom",
        path: ["maxDelayMs"],
        message: "최대 재시도 대기 시간은 최초 대기 시간보다 짧을 수 없습니다.",
      });
    }
  });

export type DailyRunAttempt = z.infer<typeof dailyRunAttemptSchema>;
export type DailyRunJournal = z.infer<typeof dailyRunJournalSchema>;
export type DailyRunLease = z.infer<typeof dailyRunLeaseSchema>;
export type DailyRetryPolicy = z.infer<typeof dailyRetryPolicySchema>;
