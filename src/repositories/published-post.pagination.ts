import { z } from "zod";

import {
  identifierSchema,
  isoTimestampSchema,
  opaqueCursorSchema,
  type PublishedPostCard,
  type PublishedPostDetail,
  type PublishedPostPage,
} from "../contracts";

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 12;

const CURSOR_VERSION = "v1";

const cursorPayloadSchema = z
  .object({
    publishedAt: isoTimestampSchema,
    id: identifierSchema,
  })
  .strict();

export type PublishedPostCursor = z.infer<typeof cursorPayloadSchema>;

export function normalizePublishedPostLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isSafeInteger(limit) || limit <= 0) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(limit, MAX_PAGE_SIZE);
}

export function encodePublishedPostCursor(
  payload: PublishedPostCursor,
): string {
  const parsed = cursorPayloadSchema.parse(payload);
  const value = [CURSOR_VERSION, parsed.publishedAt, parsed.id].join("\n");
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodePublishedPostCursor(
  cursor: string,
): PublishedPostCursor | null {
  const parsedCursor = opaqueCursorSchema.safeParse(cursor);
  if (!parsedCursor.success) {
    return null;
  }

  try {
    const decoded = Buffer.from(parsedCursor.data, "base64url").toString("utf8");
    const [version, publishedAt, id, ...unexpected] = decoded.split("\n");
    if (version !== CURSOR_VERSION || unexpected.length > 0) {
      return null;
    }

    const result = cursorPayloadSchema.safeParse({ publishedAt, id });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function toPublishedPostCard(
  post: PublishedPostDetail,
): PublishedPostCard {
  return {
    id: post.id,
    slug: post.slug,
    publicationDateKst: post.publicationDateKst,
    publishedAt: post.publishedAt,
    title: post.title,
    summary: post.summary,
    visual: { ...post.visual },
  };
}

export function emptyPublishedPostPage(): PublishedPostPage {
  return { items: [], nextCursor: null };
}
