import { Timestamp } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";

import type {
  FirestoreDocumentRecord,
  FirestorePublishedPostDataSource,
} from "../../src/db/firestore/published-post.data-source";
import {
  FirestorePublishedPostDataError,
  FirestorePublishedPostRepository,
} from "../../src/repositories/firestore-published-post.repository";
import { encodePublishedPostCursor } from "../../src/repositories/published-post.pagination";
import {
  createSamplePublishedPostSeedBundles,
  FirestoreSeedConflictError,
  seedSamplePublishedPostsWithStore,
  type FirestorePublishedPostSeedStore,
  type PublishedPostSeedBundle,
} from "../../src/repositories/firestore-sample-seeder";

function copyRecord(record: FirestoreDocumentRecord): FirestoreDocumentRecord {
  return { documentId: record.documentId, data: record.data };
}

function recordsFromBundle(bundle: PublishedPostSeedBundle) {
  const post: FirestoreDocumentRecord = {
    documentId: bundle.post.path.split("/").at(-1) ?? "",
    data: bundle.post.data,
  };
  const revision: FirestoreDocumentRecord = {
    documentId: bundle.revision.path.split("/").at(-1) ?? "",
    data: bundle.revision.data,
  };
  const slug: FirestoreDocumentRecord = {
    documentId: bundle.slug.path.split("/").at(-1) ?? "",
    data: bundle.slug.data,
  };
  return { post, revision, slug };
}

class FakeDataSource implements FirestorePublishedPostDataSource {
  cursorRows: FirestoreDocumentRecord[] = [];
  listRows: FirestoreDocumentRecord[] = [];
  post: FirestoreDocumentRecord | null = null;
  revision: FirestoreDocumentRecord | null = null;
  slug: FirestoreDocumentRecord | null = null;
  lastListInput?: { limit: number; after?: { publishedAt: string; id: string } };

  async findPublishedCursor() {
    return this.cursorRows.map(copyRecord);
  }

  async listPublishedContainers(input: {
    limit: number;
    after?: { publishedAt: string; id: string };
  }) {
    this.lastListInput = input;
    return this.listRows.slice(0, input.limit).map(copyRecord);
  }

  async getPostContainer() {
    return this.post ? copyRecord(this.post) : null;
  }

  async getPostRevision() {
    return this.revision ? copyRecord(this.revision) : null;
  }

  async getSlugReservation() {
    return this.slug ? copyRecord(this.slug) : null;
  }
}

describe("Firestore 공개 게시물 저장소", () => {
  it("published 투영만 계약 검증하고 limit+1로 다음 커서를 만든다", async () => {
    const bundles = createSamplePublishedPostSeedBundles();
    const dataSource = new FakeDataSource();
    dataSource.listRows = bundles.slice(0, 3).map((bundle) => recordsFromBundle(bundle).post);
    const repository = new FirestorePublishedPostRepository(dataSource);

    const page = await repository.list({ limit: 2 });

    expect(dataSource.lastListInput?.limit).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect(page.items.map((item) => item.id)).toEqual([
      "post-20260812",
      "post-20260811",
    ]);
  });

  it("잘못됐거나 존재하지 않는 커서는 안전한 빈 페이지를 반환한다", async () => {
    const dataSource = new FakeDataSource();
    const repository = new FirestorePublishedPostRepository(dataSource);

    await expect(repository.list({ after: "invalid" })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    const absentCursor = encodePublishedPostCursor({
      publishedAt: "2026-08-12T07:00:00+09:00",
      id: "post-20260812",
    });
    await expect(repository.list({ after: absentCursor })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("유효한 커서 문서를 확인한 뒤 같은 튜플로 다음 페이지를 조회한다", async () => {
    const bundle = createSamplePublishedPostSeedBundles()[0];
    const records = recordsFromBundle(bundle);
    const dataSource = new FakeDataSource();
    dataSource.cursorRows = [records.post];
    const repository = new FirestorePublishedPostRepository(dataSource);
    const publishedAt = (bundle.post.data.publishedAt as Timestamp)
      .toDate()
      .toISOString();
    const cursor = encodePublishedPostCursor({
      publishedAt,
      id: bundle.post.data.id as string,
    });

    await repository.list({ after: cursor });

    expect(dataSource.lastListInput?.after).toEqual({
      publishedAt,
      id: bundle.post.data.id,
    });
  });

  it("Firestore Timestamp가 아닌 publishedAt을 데이터 오류로 차단한다", async () => {
    const records = recordsFromBundle(createSamplePublishedPostSeedBundles()[0]);
    records.post.data = {
      ...(records.post.data as Record<string, unknown>),
      publishedAt: "2026-08-12",
    };
    const dataSource = new FakeDataSource();
    dataSource.listRows = [records.post];
    const repository = new FirestorePublishedPostRepository(dataSource);

    await expect(repository.list()).rejects.toMatchObject({
      name: "FirestorePublishedPostDataError",
      code: "INVALID_TIMESTAMP_publishedAt",
    });
  });

  it("비공개 컨테이너는 노출하지 않고 고아 slug는 데이터 오류로 감지한다", async () => {
    const records = recordsFromBundle(createSamplePublishedPostSeedBundles()[0]);
    const dataSource = new FakeDataSource();
    dataSource.slug = records.slug;
    dataSource.post = {
      ...records.post,
      data: {
        ...(records.post.data as Record<string, unknown>),
        status: "draft",
      },
    };
    const repository = new FirestorePublishedPostRepository(dataSource);

    await expect(repository.getBySlug("ai-answer-checking")).resolves.toBeNull();
    dataSource.post = null;
    await expect(repository.getBySlug("ai-answer-checking")).rejects.toMatchObject({
      code: "MISSING_SLUG_CONTAINER",
    });
  });

  it("활성 리비전과 공개 투영의 불일치를 데이터 오류로 차단한다", async () => {
    const records = recordsFromBundle(createSamplePublishedPostSeedBundles()[0]);
    const dataSource = new FakeDataSource();
    dataSource.slug = records.slug;
    dataSource.post = records.post;
    dataSource.revision = {
      ...records.revision,
      data: {
        ...(records.revision.data as Record<string, unknown>),
        detail: {
          ...((records.revision.data as Record<string, unknown>).detail as Record<
            string,
            unknown
          >),
          title: "공개 투영과 다른 제목",
        },
      },
    };
    const repository = new FirestorePublishedPostRepository(dataSource);

    await expect(repository.getBySlug("ai-answer-checking")).rejects.toBeInstanceOf(
      FirestorePublishedPostDataError,
    );
  });

  it("slug 예약의 ID 충돌을 데이터 오류로 차단한다", async () => {
    const records = recordsFromBundle(createSamplePublishedPostSeedBundles()[0]);
    const dataSource = new FakeDataSource();
    dataSource.slug = { ...records.slug, documentId: "different-slug" };
    const repository = new FirestorePublishedPostRepository(dataSource);

    await expect(repository.getBySlug("ai-answer-checking")).rejects.toMatchObject({
      code: "INVALID_SLUG_RESERVATION",
    });
  });
});

class InMemorySeedStore implements FirestorePublishedPostSeedStore {
  readonly documents = new Map<string, unknown>();

  async seedBundle(bundle: PublishedPostSeedBundle) {
    const documents = [bundle.post, bundle.revision, bundle.slug];
    for (const document of documents) {
      const existing = this.documents.get(document.path);
      if (existing !== undefined) {
        const { assertSeedDocumentCompatible } = await import(
          "../../src/repositories/firestore-sample-seeder"
        );
        assertSeedDocumentCompatible(existing, document);
      }
    }

    let created = 0;
    let preserved = 0;
    for (const document of documents) {
      if (this.documents.has(document.path)) {
        preserved += 1;
      } else {
        this.documents.set(document.path, document.data);
        created += 1;
      }
    }
    return { created, preserved };
  }
}

describe("Firestore 샘플 시드", () => {
  it("첫 실행은 생성하고 재실행은 동일 문서를 그대로 보존한다", async () => {
    const store = new InMemorySeedStore();

    const first = await seedSamplePublishedPostsWithStore(store);
    const second = await seedSamplePublishedPostsWithStore(store);

    expect(first).toEqual({
      postsProcessed: 15,
      documentsCreated: 45,
      documentsPreserved: 0,
    });
    expect(second).toEqual({
      postsProcessed: 15,
      documentsCreated: 0,
      documentsPreserved: 45,
    });
  });

  it("같은 경로의 다른 데이터는 덮어쓰지 않고 실패한다", async () => {
    const store = new InMemorySeedStore();
    await seedSamplePublishedPostsWithStore(store);
    const path = "postSlugs/ai-answer-checking";
    store.documents.set(path, { slug: "ai-answer-checking", postId: "other" });

    await expect(seedSamplePublishedPostsWithStore(store)).rejects.toEqual(
      new FirestoreSeedConflictError(path),
    );
    expect(store.documents.get(path)).toEqual({
      slug: "ai-answer-checking",
      postId: "other",
    });
  });
});
