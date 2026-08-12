import { z } from "zod";

import {
  publishedPostCardSchema,
  publishedPostDetailSchema,
  publishedPostPageSchema,
  slugSchema,
  type PublishedPostCard,
  type PublishedPostDetail,
} from "../contracts";
import type {
  SupabasePublishedPostDataSource,
  SupabasePublishedPostRow,
} from "../db/supabase/published-post.data-source";
import {
  decodePublishedPostCursor,
  emptyPublishedPostPage,
  encodePublishedPostCursor,
  normalizePublishedPostLimit,
  type PublishedPostCursor,
} from "./published-post.pagination";
import type {
  PublishedPostListOptions,
  PublishedPostRepository,
} from "./published-post.repository";

const publishedCardRowSchema = z
  .object({
    id: z.unknown(),
    slug: z.unknown(),
    status: z.literal("published"),
    publication_date_kst: z.unknown(),
    published_at: z.unknown(),
    title: z.unknown(),
    summary: z.unknown(),
    visual: z.unknown(),
  })
  .strict();

const publishedDetailRowSchema = publishedCardRowSchema
  .extend({
    modified_at: z.unknown(),
    one_line_summary: z.unknown(),
    body: z.unknown(),
    questions: z.unknown(),
    sources: z.unknown(),
  })
  .strict();

export class SupabasePublishedPostDataError extends Error {
  constructor(readonly code: string) {
    super(`Supabase 공개 게시물 데이터가 계약을 위반했습니다. (${code})`);
    this.name = "SupabasePublishedPostDataError";
  }
}

function requireRecord(
  row: SupabasePublishedPostRow,
): Record<string, unknown> {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new SupabasePublishedPostDataError("INVALID_ROW");
  }

  return row;
}

function assertPublishedStatus(row: Record<string, unknown>): void {
  if (typeof row.status === "string" && row.status !== "published") {
    throw new SupabasePublishedPostDataError("UNPUBLISHED_ROW");
  }
}

function parseCard(row: SupabasePublishedPostRow): PublishedPostCard {
  const record = requireRecord(row);
  assertPublishedStatus(record);
  const parsedRow = publishedCardRowSchema.safeParse(record);
  if (!parsedRow.success) {
    throw new SupabasePublishedPostDataError("INVALID_CARD_ROW");
  }

  const parsedCard = publishedPostCardSchema.safeParse({
    id: parsedRow.data.id,
    slug: parsedRow.data.slug,
    publicationDateKst: parsedRow.data.publication_date_kst,
    publishedAt: parsedRow.data.published_at,
    title: parsedRow.data.title,
    summary: parsedRow.data.summary,
    visual: parsedRow.data.visual,
  });
  if (!parsedCard.success) {
    throw new SupabasePublishedPostDataError("INVALID_CARD_ROW");
  }

  return parsedCard.data;
}

function parseDetail(row: SupabasePublishedPostRow): PublishedPostDetail {
  const record = requireRecord(row);
  assertPublishedStatus(record);
  const parsedRow = publishedDetailRowSchema.safeParse(record);
  if (!parsedRow.success) {
    throw new SupabasePublishedPostDataError("INVALID_DETAIL_ROW");
  }

  const detail = publishedPostDetailSchema.safeParse({
    id: parsedRow.data.id,
    slug: parsedRow.data.slug,
    publicationDateKst: parsedRow.data.publication_date_kst,
    publishedAt: parsedRow.data.published_at,
    modifiedAt: parsedRow.data.modified_at,
    title: parsedRow.data.title,
    summary: parsedRow.data.summary,
    visual: parsedRow.data.visual,
    oneLineSummary: parsedRow.data.one_line_summary,
    body: parsedRow.data.body,
    questions: parsedRow.data.questions,
    sources: parsedRow.data.sources,
  });
  if (!detail.success) {
    throw new SupabasePublishedPostDataError("INVALID_DETAIL_ROW");
  }

  return detail.data;
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

function compareDescending(
  previous: PublishedPostCard,
  current: PublishedPostCard,
): boolean {
  const timestampOrder =
    Date.parse(previous.publishedAt) - Date.parse(current.publishedAt);
  return (
    timestampOrder > 0 ||
    (timestampOrder === 0 && previous.id > current.id)
  );
}

export class SupabasePublishedPostRepository
  implements PublishedPostRepository
{
  constructor(private readonly dataSource: SupabasePublishedPostDataSource) {}

  async list(
    options: PublishedPostListOptions = {},
  ): ReturnType<PublishedPostRepository["list"]> {
    const limit = normalizePublishedPostLimit(options.limit);
    let cursor: PublishedPostCursor | undefined;

    if (options.after !== undefined) {
      const decodedCursor = decodePublishedPostCursor(options.after);
      if (decodedCursor === null) {
        return emptyPublishedPostPage();
      }
      cursor = decodedCursor;

      const cursorRows = await this.#query(() =>
        this.dataSource.findPublishedCursor(decodedCursor),
      );
      if (cursorRows.length === 0) {
        return emptyPublishedPostPage();
      }
      if (cursorRows.length !== 1) {
        throw new SupabasePublishedPostDataError("DUPLICATE_CURSOR");
      }

      const cursorCard = parseCard(cursorRows[0]);
      if (
        cursorCard.id !== decodedCursor.id ||
        !sameInstant(cursorCard.publishedAt, decodedCursor.publishedAt)
      ) {
        return emptyPublishedPostPage();
      }
    }

    const rows = await this.#query(() =>
      this.dataSource.listPublishedRows({ limit: limit + 1, after: cursor }),
    );
    if (rows.length > limit + 1) {
      throw new SupabasePublishedPostDataError("QUERY_LIMIT_VIOLATION");
    }

    const cards = rows.map(parseCard);
    for (let index = 1; index < cards.length; index += 1) {
      if (!compareDescending(cards[index - 1], cards[index])) {
        throw new SupabasePublishedPostDataError("INVALID_QUERY_ORDER");
      }
    }

    const selected = cards.slice(0, limit);
    const lastPost = selected.at(-1);
    return publishedPostPageSchema.parse({
      items: selected,
      nextCursor:
        cards.length > limit && lastPost
          ? encodePublishedPostCursor({
              publishedAt: lastPost.publishedAt,
              id: lastPost.id,
            })
          : null,
    });
  }

  async getBySlug(
    slug: string,
  ): ReturnType<PublishedPostRepository["getBySlug"]> {
    const parsedSlug = slugSchema.safeParse(slug);
    if (!parsedSlug.success) {
      return null;
    }

    const rows = await this.#query(() =>
      this.dataSource.findPublishedBySlug(parsedSlug.data),
    );
    if (rows.length === 0) {
      return null;
    }
    if (rows.length !== 1) {
      throw new SupabasePublishedPostDataError("DUPLICATE_SLUG");
    }

    const detail = parseDetail(rows[0]);
    if (detail.slug !== parsedSlug.data) {
      throw new SupabasePublishedPostDataError("SLUG_MISMATCH");
    }

    return detail;
  }

  async #query<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SupabasePublishedPostDataError) {
        throw error;
      }
      throw new SupabasePublishedPostDataError("DATA_API_ERROR");
    }
  }
}
