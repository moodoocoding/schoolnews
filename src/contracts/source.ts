import { z } from "zod";

import {
  articleInputSchema,
  collectionTypeSchema,
  evidenceAuthoritySchema,
  evidenceSourceRoleSchema,
  evidenceSourceTypeSchema,
  fetchableSourceUrlSchema,
  originTypeSchema,
  publisherTypeSchema,
} from "./article";
import { httpsUrlSchema, identifierSchema, isoTimestampSchema } from "./common";

export const sourceAccessStatusSchema = z.enum([
  "allowed",
  "needs_review",
  "blocked",
]);

export const sourceContentUseSchema = z.enum([
  "evidence",
  "discovery_only",
]);

export const sourceRequestPolicySchema = z
  .object({
    timeoutMs: z.number().int().min(1_000).max(30_000),
    minIntervalMs: z.number().int().min(60_000).max(86_400_000),
    maxResponseBytes: z.number().int().min(16_384).max(2_000_000),
    maxItemsPerRun: z.number().int().min(1).max(100),
    maxRedirects: z.number().int().min(0).max(5),
  })
  .strict();

export const sourceRegistryEntrySchema = z
  .object({
    sourceId: identifierSchema,
    name: z.string().trim().min(1).max(200),
    publisherGroupId: identifierSchema,
    provenanceGroupPrefix: identifierSchema,
    collectionType: collectionTypeSchema,
    feedUrl: fetchableSourceUrlSchema,
    siteUrl: httpsUrlSchema,
    publisherType: publisherTypeSchema,
    originType: originTypeSchema,
    sourceRole: evidenceSourceRoleSchema,
    sourceType: evidenceSourceTypeSchema,
    authority: evidenceAuthoritySchema,
    contentUse: sourceContentUseSchema,
    locale: z.string().trim().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
    enabled: z.boolean(),
    accessStatus: sourceAccessStatusSchema,
    accessReviewedAt: isoTimestampSchema,
    policyReferenceUrls: z.array(httpsUrlSchema).min(1).max(5),
    requestPolicy: sourceRequestPolicySchema,
    notes: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.enabled && source.accessStatus !== "allowed") {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "활성 수집원은 접근 허용 검토가 완료되어야 합니다.",
      });
    }

    if (source.collectionType === "html") {
      context.addIssue({
        code: "custom",
        path: ["collectionType"],
        message: "원문 HTML 크롤링 수집원은 활성화할 수 없습니다.",
      });
    }
  });

export const collectionIssueCodeSchema = z.enum([
  "SOURCE_UNAVAILABLE",
  "COLLECTION_TIMEOUT",
  "INVALID_SOURCE_DATA",
  "UNSAFE_SOURCE_URL",
  "RESPONSE_TOO_LARGE",
  "UNSUPPORTED_CONTENT_TYPE",
  "REDIRECT_LIMIT_EXCEEDED",
  "ITEM_SKIPPED",
]);

export const collectionIssueSchema = z
  .object({
    code: collectionIssueCodeSchema,
    message: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
    itemIndex: z.number().int().min(0).nullable(),
  })
  .strict();

export const sourceCollectionOutcomeSchema = z
  .object({
    sourceId: identifierSchema,
    status: z.enum(["succeeded", "partial", "failed"]),
    startedAt: isoTimestampSchema,
    finishedAt: isoTimestampSchema,
    items: z.array(articleInputSchema),
    issues: z.array(collectionIssueSchema),
  })
  .strict()
  .superRefine((outcome, context) => {
    if (new Date(outcome.finishedAt) < new Date(outcome.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "수집 종료 시각은 시작 시각보다 빠를 수 없습니다.",
      });
    }

    if (outcome.status === "succeeded" && outcome.issues.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["issues"],
        message: "성공한 수집에는 오류가 있을 수 없습니다.",
      });
    }

    if (
      outcome.status === "partial" &&
      (outcome.items.length === 0 || outcome.issues.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "부분 성공에는 수집 항목과 오류가 모두 필요합니다.",
      });
    }

    if (
      outcome.status === "failed" &&
      (outcome.items.length > 0 || outcome.issues.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "실패한 수집은 항목 없이 하나 이상의 오류를 가져야 합니다.",
      });
    }

    outcome.items.forEach((item, index) => {
      if (item.sourceId !== outcome.sourceId) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "sourceId"],
          message: "수집 항목의 sourceId는 수집 결과의 sourceId와 같아야 합니다.",
        });
      }
    });
  });

export type SourceRegistryEntry = z.infer<typeof sourceRegistryEntrySchema>;
export type CollectionIssue = z.infer<typeof collectionIssueSchema>;
export type SourceCollectionOutcome = z.infer<typeof sourceCollectionOutcomeSchema>;
