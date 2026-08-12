import { z } from "zod";

import {
  graphemeTextSchema,
  getPublicationDateKst,
  httpsUrlSchema,
  identifierSchema,
  isoTimestampSchema,
  opaqueCursorSchema,
  publicationDateKstSchema,
  slugSchema,
} from "./common";

export const postVisualSchema = z
  .object({
    kind: z.literal("pattern"),
    seed: z.string().min(16).max(128),
    templateVersion: z.string().trim().min(1).max(64),
  })
  .strict();

export const publishedPostCardSchema = z
  .object({
    id: identifierSchema,
    slug: slugSchema,
    publicationDateKst: publicationDateKstSchema,
    publishedAt: isoTimestampSchema,
    title: graphemeTextSchema({ label: "제목", max: 36 }),
    summary: graphemeTextSchema({ label: "한 줄 요약", max: 100 }),
    visual: postVisualSchema,
  })
  .strict()
  .superRefine((post, context) => {
    if (getPublicationDateKst(post.publishedAt) !== post.publicationDateKst) {
      context.addIssue({
        code: "custom",
        path: ["publicationDateKst"],
        message: "게시일은 publishedAt 순간의 KST 날짜와 같아야 합니다.",
      });
    }
  });

export const citedPublicClaimSchema = z
  .object({
    text: graphemeTextSchema({ label: "공개 문장", max: 260 }),
    sourceIds: z
      .array(identifierSchema)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "공개 문장의 출처 ID는 중복될 수 없습니다.",
      }),
  })
  .strict();

export const publishedSourceSchema = z
  .object({
    id: identifierSchema,
    title: z.string().trim().min(1).max(500),
    publisher: z.string().trim().min(1).max(200),
    publishedDate: publicationDateKstSchema.nullable(),
    originalUrl: httpsUrlSchema,
  })
  .strict();

export const publishedPostDetailSchema = publishedPostCardSchema
  .safeExtend({
    modifiedAt: isoTimestampSchema,
    oneLineSummary: citedPublicClaimSchema,
    body: z
      .array(
        z
          .object({
            claims: z.array(citedPublicClaimSchema).min(1),
          })
          .strict(),
      )
      .min(3)
      .max(5),
    questions: z
      .array(graphemeTextSchema({ label: "질문", max: 80 }))
      .min(1)
      .max(2),
    sources: z.array(publishedSourceSchema).min(1),
  })
  .strict()
  .superRefine((post, context) => {
    const sourceIds = new Set(post.sources.map((source) => source.id));
    if (sourceIds.size !== post.sources.length) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "공개 출처 ID는 중복될 수 없습니다.",
      });
    }
    const claims = [
      post.oneLineSummary,
      ...post.body.flatMap((paragraph) => paragraph.claims),
    ];
    const missingSources = claims.flatMap((claim) =>
      claim.sourceIds.filter((sourceId) => !sourceIds.has(sourceId)),
    );

    if (missingSources.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "공개 문장의 출처 ID는 sources에 존재해야 합니다.",
      });
    }
  });

export const publishedPostPageSchema = z
  .object({
    items: z.array(publishedPostCardSchema).max(12),
    nextCursor: opaqueCursorSchema.nullable(),
  })
  .strict();

export type PostVisual = z.infer<typeof postVisualSchema>;
export type PublishedPostCard = z.infer<typeof publishedPostCardSchema>;
export type PublishedSource = z.infer<typeof publishedSourceSchema>;
export type PublishedPostDetail = z.infer<typeof publishedPostDetailSchema>;
export type PublishedPostPage = z.infer<typeof publishedPostPageSchema>;
