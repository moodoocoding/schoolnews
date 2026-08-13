import { z } from "zod";

import {
  httpsUrlSchema,
  identifierSchema,
  isoTimestampSchema,
  nullableShortTextSchema,
  sha256Schema,
} from "./common";

export const collectionTypeSchema = z.enum(["rss", "api", "html"]);
export const publisherTypeSchema = z.enum([
  "official",
  "news",
  "wire",
  "research",
  "other",
]);
export const originTypeSchema = z.enum([
  "primary_document",
  "original_reporting",
  "wire",
  "press_release_rewrite",
  "unknown",
]);
export const publicationTimePrecisionSchema = z.enum(["date", "instant"]);
export const evidenceSourceRoleSchema = z.enum([
  "primary",
  "independent",
  "supporting",
]);
export const evidenceSourceTypeSchema = z.enum(["primary", "news", "research"]);
export const evidenceAuthoritySchema = z.enum([
  "none",
  "public_authority_direct_fact",
]);

export const articleInputSchema = z
  .object({
    sourceId: identifierSchema,
    externalId: z.string().trim().min(1).max(512).nullable(),
    originalUrl: httpsUrlSchema,
    hostedArticleUrl: httpsUrlSchema.nullable().optional(),
    title: z.string().trim().min(1).max(500),
    excerpt: nullableShortTextSchema,
    author: z.string().trim().max(300).nullable(),
    publisher: z.string().trim().min(1).max(200),
    publishedAt: isoTimestampSchema,
    publishedAtPrecision: publicationTimePrecisionSchema,
    discoveredAt: isoTimestampSchema,
  })
  .strict();

export const normalizedArticleSchema = articleInputSchema
  .extend({
    articleId: identifierSchema,
    publisherGroupId: identifierSchema,
    provenanceGroupKey: identifierSchema,
    canonicalUrl: httpsUrlSchema,
    canonicalUrlHash: sha256Schema,
    normalizedTitle: z.string().trim().min(1).max(500),
    contentFingerprint: sha256Schema,
    canonicalizationVersion: z.string().trim().min(1).max(64),
    fingerprintVersion: z.string().trim().min(1).max(64),
    originType: originTypeSchema,
  })
  .strict();

export const evidenceItemSchema = z
  .object({
    evidenceId: identifierSchema,
    articleId: identifierSchema,
    passageId: identifierSchema,
    passageHash: sha256Schema,
    sourceId: identifierSchema,
    publisherGroupId: identifierSchema,
    provenanceGroupKey: identifierSchema,
    sourceRole: evidenceSourceRoleSchema,
    sourceType: evidenceSourceTypeSchema,
    authority: evidenceAuthoritySchema.default("none"),
    sourceName: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    url: httpsUrlSchema,
    publishedAt: isoTimestampSchema,
    publishedAtPrecision: publicationTimePrecisionSchema,
    passage: z.string().trim().min(1).max(2_000),
    locator: z.string().trim().max(300).nullable(),
  })
  .strict();

/**
 * Private, server-only article text supplied to the model after an explicit
 * source-use review. It is never part of the public post projection.
 */
export const articleModelDocumentSchema = z
  .object({
    documentId: identifierSchema,
    articleId: identifierSchema,
    sourceId: identifierSchema,
    evidenceId: identifierSchema,
    sourceName: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    publishedAt: isoTimestampSchema,
    contentText: z.string().trim().min(1).max(100_000),
    contentHash: sha256Schema,
    fetchedAt: isoTimestampSchema,
    retentionExpiresAt: isoTimestampSchema,
    rightsBasisUrl: httpsUrlSchema,
    termsReviewedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((document, context) => {
    if (new Date(document.retentionExpiresAt) <= new Date(document.fetchedAt)) {
      context.addIssue({
        code: "custom",
        path: ["retentionExpiresAt"],
        message: "원문 보존 만료 시각은 수집 시각보다 뒤여야 합니다.",
      });
    }
  });

export const fetchableSourceUrlSchema = httpsUrlSchema.superRefine(
  (value, context) => {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const blockedHost =
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".localhost") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);

    if (url.username || url.password || blockedHost) {
      context.addIssue({
        code: "custom",
        message: "수집 요청 URL에는 자격 증명이나 로컬·사설 호스트를 사용할 수 없습니다.",
      });
    }
  },
);

export type ArticleInput = z.infer<typeof articleInputSchema>;
export type NormalizedArticle = z.infer<typeof normalizedArticleSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type ArticleModelDocument = z.infer<typeof articleModelDocumentSchema>;
