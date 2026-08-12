import { z } from "zod";

import { graphemeLength, graphemeTextSchema, identifierSchema } from "./common";

export const claimKindSchema = z.enum(["fact", "context", "interpretation"]);
export const claimImportanceSchema = z.enum(["key", "supporting"]);

export const evidenceRefSchema = z
  .object({
    evidenceId: identifierSchema,
    support: z.enum(["direct", "context"]),
  })
  .strict();

export const claimSchema = z
  .object({
    claimId: identifierSchema,
    text: graphemeTextSchema({ label: "주장", max: 240 }),
    kind: claimKindSchema,
    importance: claimImportanceSchema,
    displayCitation: z.boolean(),
    evidenceRefs: z.array(evidenceRefSchema),
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      (claim.kind === "fact" || claim.kind === "context") &&
      claim.evidenceRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: "사실과 맥락 주장에는 근거가 필요합니다.",
      });
    }

    if (claim.importance === "key" && !claim.displayCitation) {
      context.addIssue({
        code: "custom",
        path: ["displayCitation"],
        message: "핵심 주장은 공개 출처 표시 대상이어야 합니다.",
      });
    }
  });

export const citedSentenceSchema = z
  .object({
    sentenceId: identifierSchema,
    text: graphemeTextSchema({ label: "문장", max: 260 }),
    claimIds: z.array(identifierSchema).min(1),
  })
  .strict();

export const contentParagraphSchema = z
  .object({
    sentences: z.array(citedSentenceSchema).min(1).max(8),
  })
  .strict();

export const generatedPostSchema = z
  .object({
    title: graphemeTextSchema({ label: "제목", max: 36 }),
    oneLineSummary: citedSentenceSchema,
    body: z.array(contentParagraphSchema).min(3).max(5),
    questions: z
      .array(graphemeTextSchema({ label: "질문", max: 80 }))
      .min(1)
      .max(2),
    claims: z.array(claimSchema).min(1),
    usedEvidenceIds: z.array(identifierSchema).min(1),
  })
  .strict()
  .superRefine((post, context) => {
    if (graphemeLength(post.oneLineSummary.text) > 100) {
      context.addIssue({
        code: "custom",
        path: ["oneLineSummary", "text"],
        message: "한 줄 요약은 최대 100자여야 합니다.",
      });
    }

    const bodyLength = post.body.reduce(
      (total, paragraph) =>
        total +
        paragraph.sentences.reduce(
          (paragraphTotal, sentence) =>
            paragraphTotal + graphemeLength(sentence.text),
          0,
        ),
      0,
    );

    if (bodyLength > 900) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "본문은 최대 900자여야 합니다.",
      });
    }

    const claimsById = new Map(post.claims.map((claim) => [claim.claimId, claim]));
    const sentences = [
      post.oneLineSummary,
      ...post.body.flatMap((paragraph) => paragraph.sentences),
    ];
    const missingClaimIds = sentences.flatMap((sentence) =>
      sentence.claimIds.filter((claimId) => !claimsById.has(claimId)),
    );

    const duplicateClaimIds = post.claims
      .map((claim) => claim.claimId)
      .filter((claimId, index, claimIds) => claimIds.indexOf(claimId) !== index);
    const sentenceIds = sentences.map((sentence) => sentence.sentenceId);
    const duplicateSentenceIds = sentenceIds.filter(
      (sentenceId, index) => sentenceIds.indexOf(sentenceId) !== index,
    );
    const referencedClaimIds = new Set(
      sentences.flatMap((sentence) => sentence.claimIds),
    );
    const orphanedClaimIds = post.claims
      .map((claim) => claim.claimId)
      .filter((claimId) => !referencedClaimIds.has(claimId));

    if (missingClaimIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["body"],
        message: "모든 문장의 주장 ID가 claims에 존재해야 합니다.",
      });
    }

    if (duplicateClaimIds.length > 0 || duplicateSentenceIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["claims"],
        message: "주장 ID와 문장 ID는 각각 고유해야 합니다.",
      });
    }

    if (orphanedClaimIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["claims"],
        message: "모든 주장은 공개 문장에서 참조되어야 합니다.",
      });
    }

    const claimedEvidenceIds = new Set(
      post.claims.flatMap((claim) =>
        claim.evidenceRefs.map((reference) => reference.evidenceId),
      ),
    );
    const usedEvidenceIds = new Set(post.usedEvidenceIds);
    const evidenceMismatch =
      Array.from(claimedEvidenceIds).some(
        (evidenceId) => !usedEvidenceIds.has(evidenceId),
      ) ||
      Array.from(usedEvidenceIds).some(
        (evidenceId) => !claimedEvidenceIds.has(evidenceId),
      );

    if (evidenceMismatch) {
      context.addIssue({
        code: "custom",
        path: ["usedEvidenceIds"],
        message: "사용 근거 목록은 주장에 연결된 근거와 정확히 일치해야 합니다.",
      });
    }
  });

export const qualityBlockingReasonSchema = z.enum([
  "MISSING_EVIDENCE",
  "INSUFFICIENT_INDEPENDENT_SOURCES",
  "UNSUPPORTED_CLAIM",
  "CONTRADICTED_CLAIM",
  "CAUSAL_OVERREACH",
  "DUPLICATE_TOPIC",
  "PROMOTIONAL_LANGUAGE",
  "SOURCE_CONFLICT",
  "FORMAT_INVALID",
  "CONTENT_TOO_LONG",
  "SOURCE_METADATA_INVALID",
  "BUDGET_EXCEEDED",
]);

export const qualityResultSchema = z
  .object({
    passed: z.boolean(),
    checks: z
      .array(
        z
          .object({
            type: z.string().trim().min(1).max(100),
            passed: z.boolean(),
            score: z.number().min(0).max(100).optional(),
            reasons: z.array(z.string().trim().min(1).max(500)),
            checkerVersion: z.string().trim().min(1).max(64),
          })
          .strict(),
      )
      .min(1),
    blockingReasons: z.array(qualityBlockingReasonSchema),
  })
  .strict()
  .superRefine((result, context) => {
    const hasFailedCheck = result.checks.some((check) => !check.passed);
    if (result.passed && (hasFailedCheck || result.blockingReasons.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "통과 결과에는 실패 검사나 차단 사유가 있을 수 없습니다.",
      });
    }
    if (!result.passed && result.blockingReasons.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["blockingReasons"],
        message: "실패 결과에는 하나 이상의 차단 사유가 필요합니다.",
      });
    }
    if (
      !result.passed &&
      !hasFailedCheck &&
      result.blockingReasons.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["checks"],
        message: "차단된 결과에는 대응하는 실패 검사가 필요합니다.",
      });
    }
  });

export type Claim = z.infer<typeof claimSchema>;
export type CitedSentence = z.infer<typeof citedSentenceSchema>;
export type GeneratedPost = z.infer<typeof generatedPostSchema>;
export type QualityResult = z.infer<typeof qualityResultSchema>;
