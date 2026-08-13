import { z } from "zod";

import { identifierSchema, isoTimestampSchema } from "../../contracts";

export const FULL_TEXT_COLLECTOR_USER_AGENT =
  "AI-Education-Today-FullText-Collector/0.1 (+educational-news-curation)";

export const fullTextSourcePolicySchema = z
  .object({
    sourceId: identifierSchema,
    fullTextUseAllowed: z.literal(true),
    allowedOrigins: z
      .array(
        z.string().url().transform((value, context) => {
          const url = new URL(value);
          if (
            url.protocol !== "https:" ||
            url.username !== "" ||
            url.password !== "" ||
            url.pathname !== "/" ||
            url.search !== "" ||
            url.hash !== ""
          ) {
            context.addIssue({
              code: "custom",
              message: "원문 허용 주소는 HTTPS origin이어야 합니다.",
            });
            return z.NEVER;
          }
          return url.origin;
        }),
      )
      .min(1)
      .max(5),
    accessReviewedAt: isoTimestampSchema,
    policyReferenceUrls: z.array(z.string().url().startsWith("https://")).min(1).max(5),
    retentionDays: z.number().int().min(1).max(90),
    timeoutMs: z.number().int().min(1_000).max(30_000),
    maxResponseBytes: z.number().int().min(16_384).max(500_000),
    maxTextCharacters: z.number().int().min(1_000).max(100_000),
    maxRedirects: z.number().int().min(0).max(3),
    notes: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((policy, context) => {
    if (new Set(policy.allowedOrigins).size !== policy.allowedOrigins.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedOrigins"],
        message: "허용 origin은 중복될 수 없습니다.",
      });
    }
  });

export type FullTextSourcePolicy = z.infer<typeof fullTextSourcePolicySchema>;

/**
 * Deliberately empty by default. A publisher may be added only in a forward
 * change that records the reviewed terms/permission URL. Discovery adapters
 * never inherit full-text permission implicitly.
 */
export const FULL_TEXT_SOURCE_POLICIES: ReadonlyMap<string, FullTextSourcePolicy> =
  new Map();
