import { z } from "zod";

import {
  getPublicationDateKst,
  identifierSchema,
  isoTimestampSchema,
  publicationDateKstSchema,
  slugSchema,
} from "./common";
import {
  postVisualSchema,
  publishedPostDetailSchema,
} from "./public";

export const FIRESTORE_SCHEMA_VERSION = "firestore-v1" as const;

export const postStatusSchema = z.enum([
  "draft",
  "validated",
  "published",
  "rejected",
  "withheld",
]);

export const publishedPostContainerSchema = z
  .object({
    schemaVersion: z.literal(FIRESTORE_SCHEMA_VERSION),
    id: identifierSchema,
    slug: slugSchema,
    publicationDateKst: publicationDateKstSchema,
    status: z.literal("published"),
    activeRevisionId: identifierSchema,
    publishedAt: isoTimestampSchema,
    modifiedAt: isoTimestampSchema,
    title: publishedPostDetailSchema.shape.title,
    summary: publishedPostDetailSchema.shape.summary,
    visual: postVisualSchema,
  })
  .strict()
  .superRefine((post, context) => {
    if (getPublicationDateKst(post.publishedAt) !== post.publicationDateKst) {
      context.addIssue({
        code: "custom",
        path: ["publicationDateKst"],
        message: "게시물 문서 날짜는 publishedAt 순간의 KST 날짜와 같아야 합니다.",
      });
    }
  });

export const postRevisionDocumentSchema = z
  .object({
    schemaVersion: z.literal(FIRESTORE_SCHEMA_VERSION),
    revisionId: identifierSchema,
    postId: identifierSchema,
    createdAt: isoTimestampSchema,
    detail: publishedPostDetailSchema,
  })
  .strict()
  .superRefine((revision, context) => {
    if (revision.detail.id !== revision.postId) {
      context.addIssue({
        code: "custom",
        path: ["detail", "id"],
        message: "리비전의 게시물 ID는 postId와 같아야 합니다.",
      });
    }
    if (Date.parse(revision.createdAt) !== Date.parse(revision.detail.modifiedAt)) {
      context.addIssue({
        code: "custom",
        path: ["createdAt"],
        message: "리비전 생성 시각은 상세 수정 시각과 같아야 합니다.",
      });
    }
    if (Date.parse(revision.detail.modifiedAt) < Date.parse(revision.detail.publishedAt)) {
      context.addIssue({
        code: "custom",
        path: ["detail", "modifiedAt"],
        message: "상세 수정 시각은 게시 시각보다 빠를 수 없습니다.",
      });
    }
  });

export const postSlugDocumentSchema = z
  .object({
    schemaVersion: z.literal(FIRESTORE_SCHEMA_VERSION),
    slug: slugSchema,
    postDocumentId: publicationDateKstSchema,
    postId: identifierSchema,
  })
  .strict();

export type PostStatus = z.infer<typeof postStatusSchema>;
export type PublishedPostContainer = z.infer<
  typeof publishedPostContainerSchema
>;
export type PostRevisionDocument = z.infer<
  typeof postRevisionDocumentSchema
>;
export type PostSlugDocument = z.infer<typeof postSlugDocumentSchema>;
