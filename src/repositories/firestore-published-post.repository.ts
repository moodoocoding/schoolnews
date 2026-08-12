import { Timestamp } from "@google-cloud/firestore";

import {
  postRevisionDocumentSchema,
  postSlugDocumentSchema,
  publishedPostContainerSchema,
  publishedPostDetailSchema,
  publishedPostPageSchema,
  slugSchema,
  type PostRevisionDocument,
  type PublishedPostContainer,
  type PublishedPostDetail,
} from "../contracts";
import {
  type FirestoreDocumentRecord,
  type FirestorePublishedPostDataSource,
} from "../db/firestore/published-post.data-source";
import {
  decodePublishedPostCursor,
  emptyPublishedPostPage,
  encodePublishedPostCursor,
  normalizePublishedPostLimit,
} from "./published-post.pagination";
import type {
  PublishedPostListOptions,
  PublishedPostRepository,
} from "./published-post.repository";

export class FirestorePublishedPostDataError extends Error {
  constructor(readonly code: string) {
    super(`Firestore 공개 게시물 데이터가 계약을 위반했습니다. (${code})`);
    this.name = "FirestorePublishedPostDataError";
  }
}

function requireRecordData(
  record: FirestoreDocumentRecord,
): Record<string, unknown> {
  if (
    record.data === null ||
    typeof record.data !== "object" ||
    Array.isArray(record.data)
  ) {
    throw new FirestorePublishedPostDataError("INVALID_DOCUMENT");
  }

  return record.data as Record<string, unknown>;
}

function timestampToIso(value: unknown, field: string): string {
  if (!(value instanceof Timestamp)) {
    throw new FirestorePublishedPostDataError(`INVALID_TIMESTAMP_${field}`);
  }

  const date = value.toDate();
  if (!Number.isFinite(date.getTime())) {
    throw new FirestorePublishedPostDataError(`INVALID_TIMESTAMP_${field}`);
  }

  return date.toISOString();
}

function parseContainer(
  record: FirestoreDocumentRecord,
): PublishedPostContainer {
  const data = requireRecordData(record);
  const parsed = publishedPostContainerSchema.safeParse({
    ...data,
    publishedAt: timestampToIso(data.publishedAt, "publishedAt"),
    modifiedAt: timestampToIso(data.modifiedAt, "modifiedAt"),
  });

  if (!parsed.success || record.documentId !== parsed.data.publicationDateKst) {
    throw new FirestorePublishedPostDataError("INVALID_PUBLISHED_CONTAINER");
  }

  return parsed.data;
}

function parseRevision(
  record: FirestoreDocumentRecord,
): PostRevisionDocument {
  const data = requireRecordData(record);
  const parsed = postRevisionDocumentSchema.safeParse({
    ...data,
    createdAt: timestampToIso(data.createdAt, "createdAt"),
  });

  if (!parsed.success || record.documentId !== parsed.data.revisionId) {
    throw new FirestorePublishedPostDataError("INVALID_POST_REVISION");
  }

  return parsed.data;
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

function sameVisual(
  left: PublishedPostContainer["visual"],
  right: PublishedPostDetail["visual"],
): boolean {
  return (
    left.kind === right.kind &&
    left.seed === right.seed &&
    left.templateVersion === right.templateVersion
  );
}

function projectionMatchesDetail(
  container: PublishedPostContainer,
  detail: PublishedPostDetail,
): boolean {
  return (
    container.id === detail.id &&
    container.slug === detail.slug &&
    container.publicationDateKst === detail.publicationDateKst &&
    sameInstant(container.publishedAt, detail.publishedAt) &&
    sameInstant(container.modifiedAt, detail.modifiedAt) &&
    container.title === detail.title &&
    container.summary === detail.summary &&
    sameVisual(container.visual, detail.visual)
  );
}

export class FirestorePublishedPostRepository
  implements PublishedPostRepository
{
  constructor(private readonly dataSource: FirestorePublishedPostDataSource) {}

  async list(
    options: PublishedPostListOptions = {},
  ): ReturnType<PublishedPostRepository["list"]> {
    const limit = normalizePublishedPostLimit(options.limit);
    let cursor;

    if (options.after !== undefined) {
      cursor = decodePublishedPostCursor(options.after);
      if (cursor === null) {
        return emptyPublishedPostPage();
      }

      const cursorRows = await this.dataSource.findPublishedCursor(cursor);
      if (cursorRows.length === 0) {
        return emptyPublishedPostPage();
      }
      if (cursorRows.length !== 1) {
        throw new FirestorePublishedPostDataError("DUPLICATE_CURSOR");
      }

      const cursorContainer = parseContainer(cursorRows[0]);
      if (
        cursorContainer.id !== cursor.id ||
        !sameInstant(cursorContainer.publishedAt, cursor.publishedAt)
      ) {
        return emptyPublishedPostPage();
      }
    }

    const rows = await this.dataSource.listPublishedContainers({
      limit: limit + 1,
      after: cursor,
    });
    if (rows.length > limit + 1) {
      throw new FirestorePublishedPostDataError("QUERY_LIMIT_VIOLATION");
    }

    const containers = rows.map(parseContainer);
    for (let index = 1; index < containers.length; index += 1) {
      const previous = containers[index - 1];
      const current = containers[index];
      const timestampOrder =
        Date.parse(previous.publishedAt) - Date.parse(current.publishedAt);
      if (
        timestampOrder < 0 ||
        (timestampOrder === 0 && previous.id <= current.id)
      ) {
        throw new FirestorePublishedPostDataError("INVALID_QUERY_ORDER");
      }
    }

    const selected = containers.slice(0, limit);
    const hasNextPage = containers.length > limit;
    const lastPost = selected.at(-1);

    return publishedPostPageSchema.parse({
      items: selected.map((post) => ({
        id: post.id,
        slug: post.slug,
        publicationDateKst: post.publicationDateKst,
        publishedAt: post.publishedAt,
        title: post.title,
        summary: post.summary,
        visual: post.visual,
      })),
      nextCursor:
        hasNextPage && lastPost
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

    const slugRecord = await this.dataSource.getSlugReservation(parsedSlug.data);
    if (slugRecord === null) {
      return null;
    }
    const parsedReservation = postSlugDocumentSchema.safeParse(slugRecord.data);
    if (
      !parsedReservation.success ||
      slugRecord.documentId !== parsedReservation.data.slug
    ) {
      throw new FirestorePublishedPostDataError("INVALID_SLUG_RESERVATION");
    }

    const reservation = parsedReservation.data;
    if (reservation.slug !== parsedSlug.data) {
      return null;
    }

    const containerRecord = await this.dataSource.getPostContainer(
      reservation.postDocumentId,
    );
    if (containerRecord === null) {
      throw new FirestorePublishedPostDataError("MISSING_SLUG_CONTAINER");
    }
    const rawContainer = requireRecordData(containerRecord);
    if (rawContainer.status !== "published") {
      return null;
    }

    const container = parseContainer(containerRecord);
    if (
      container.id !== reservation.postId ||
      container.slug !== reservation.slug ||
      container.publicationDateKst !== reservation.postDocumentId
    ) {
      throw new FirestorePublishedPostDataError("SLUG_CONTAINER_MISMATCH");
    }

    const revisionRecord = await this.dataSource.getPostRevision(
      reservation.postDocumentId,
      container.activeRevisionId,
    );
    if (revisionRecord === null) {
      throw new FirestorePublishedPostDataError("MISSING_ACTIVE_REVISION");
    }

    const revision = parseRevision(revisionRecord);
    const detail = publishedPostDetailSchema.parse(revision.detail);
    if (
      revision.revisionId !== container.activeRevisionId ||
      revision.postId !== container.id ||
      !projectionMatchesDetail(container, detail)
    ) {
      throw new FirestorePublishedPostDataError("ACTIVE_REVISION_MISMATCH");
    }

    return publishedPostDetailSchema.parse(detail);
  }
}
