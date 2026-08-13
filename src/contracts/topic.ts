import { z } from "zod";

import { identifierSchema } from "./common";

export const evidencePolicySchema = z.enum([
  "primary_plus_independent",
  "two_independent_sources",
  "authoritative_single_source",
]);

export const independenceReasonSchema = z.enum([
  "independent",
  "same_owner",
  "same_wire_origin",
  "same_press_release",
  "near_duplicate",
  "unknown_provenance",
]);

export const topicScoreSchema = z
  .object({
    total: z.number().int().min(0).max(100),
    elementaryRelevance: z.number().int().min(0).max(30),
    aiDigitalSpecificity: z.number().int().min(0).max(20),
    reliability: z.number().int().min(0).max(20),
    novelty: z.number().int().min(0).max(20),
    socialMeaning: z.number().int().min(0).max(10),
    version: z.string().trim().min(1).max(64),
  })
  .strict()
  .superRefine((score, context) => {
    const expectedTotal =
      score.elementaryRelevance +
      score.aiDigitalSpecificity +
      score.reliability +
      score.novelty +
      score.socialMeaning;

    if (score.total !== expectedTotal) {
      context.addIssue({
        code: "custom",
        path: ["total"],
        message: "총점은 세부 점수의 합과 같아야 합니다.",
      });
    }
  });

export const topicCandidateSchema = z
  .object({
    topicId: identifierSchema,
    articleIds: z.array(identifierSchema).min(1),
    evidenceIds: z.array(identifierSchema).min(1),
    score: topicScoreSchema,
    independence: z
      .object({
        qualifyingGroupCount: z.number().int().min(1),
        hasPrimaryAndIndependent: z.boolean(),
        passed: z.boolean(),
        reasons: z.array(independenceReasonSchema).min(1),
      })
      .strict(),
    evidencePolicy: evidencePolicySchema,
    evidencePolicyReason: z.string().trim().min(1).max(1_000),
    newFactEvidenceIds: z.array(identifierSchema).min(1),
    selectionReason: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((candidate, context) => {
    const evidenceIds = new Set(candidate.evidenceIds);
    const missingNewFacts = candidate.newFactEvidenceIds.filter(
      (evidenceId) => !evidenceIds.has(evidenceId),
    );

    if (missingNewFacts.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["newFactEvidenceIds"],
        message: "새 사실 근거는 후보 근거 목록에 포함되어야 합니다.",
      });
    }

    const meetsScoreThreshold =
      candidate.score.total >= 70 &&
      candidate.score.elementaryRelevance >= 18 &&
      candidate.score.aiDigitalSpecificity >= 10 &&
      candidate.score.reliability >= 12 &&
      candidate.score.novelty >= 10;

    if (candidate.independence.passed && !meetsScoreThreshold) {
      context.addIssue({
        code: "custom",
        path: ["score"],
        message: "선정 가능한 후보는 합의된 최소 점수를 충족해야 합니다.",
      });
    }

    if (
      candidate.independence.passed &&
      candidate.independence.reasons.some((reason) => reason !== "independent")
    ) {
      context.addIssue({
        code: "custom",
        path: ["independence", "reasons"],
        message: "독립성 통과 결과에는 실패 사유가 포함될 수 없습니다.",
      });
    }

    if (
      candidate.evidencePolicy === "primary_plus_independent" &&
      candidate.independence.passed &&
      !candidate.independence.hasPrimaryAndIndependent
    ) {
      context.addIssue({
        code: "custom",
        path: ["independence", "hasPrimaryAndIndependent"],
        message: "공식 자료+독립 기관·연구·보도 정책에는 두 유형의 근거가 모두 필요합니다.",
      });
    }

    if (
      candidate.evidencePolicy !== "authoritative_single_source" &&
      candidate.independence.passed &&
      candidate.independence.qualifyingGroupCount < 2
    ) {
      context.addIssue({
        code: "custom",
        path: ["independence", "qualifyingGroupCount"],
        message: "복수 출처 정책은 두 개 이상의 독립 출처군이 필요합니다.",
      });
    }
  });

export type TopicScore = z.infer<typeof topicScoreSchema>;
export type TopicCandidate = z.infer<typeof topicCandidateSchema>;
