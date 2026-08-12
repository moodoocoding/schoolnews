import { describe, expect, it } from "vitest";

import type { PublishedPostDetail } from "../../src/contracts";
import {
  SupabaseDataApiError,
  SupabaseRestPublishedPostDataSource,
  type SupabasePublishedPostDataSource,
  type SupabasePublishedPostListQuery,
  type SupabasePublishedPostRow,
} from "../../src/db/supabase/published-post.data-source";
import { encodePublishedPostCursor } from "../../src/repositories/published-post.pagination";
import { getSamplePublishedPosts } from "../../src/repositories/published-post.samples";
import {
  SupabasePublishedPostDataError,
  SupabasePublishedPostRepository,
} from "../../src/repositories/supabase-published-post.repository";

function toListRow(post: PublishedPostDetail): SupabasePublishedPostRow {
  return {
    id: post.id,
    slug: post.slug,
    status: "published",
    publication_date_kst: post.publicationDateKst,
    published_at: post.publishedAt,
    title: post.title,
    summary: post.summary,
    visual: structuredClone(post.visual),
  };
}

function toDetailRow(post: PublishedPostDetail): SupabasePublishedPostRow {
  return {
    ...toListRow(post),
    modified_at: post.modifiedAt,
    one_line_summary: structuredClone(post.oneLineSummary),
    body: structuredClone(post.body),
    questions: structuredClone(post.questions),
    sources: structuredClone(post.sources),
  };
}

class FakeDataSource implements SupabasePublishedPostDataSource {
  cursorRows: SupabasePublishedPostRow[] = [];
  listRows: SupabasePublishedPostRow[] = [];
  detailRows: SupabasePublishedPostRow[] = [];
  error: Error | null = null;
  lastListInput?: SupabasePublishedPostListQuery;
  detailCalls = 0;

  async findPublishedCursor() {
    this.#throwIfConfigured();
    return structuredClone(this.cursorRows);
  }

  async listPublishedRows(input: SupabasePublishedPostListQuery) {
    this.#throwIfConfigured();
    this.lastListInput = structuredClone(input);
    return structuredClone(this.listRows);
  }

  async findPublishedBySlug() {
    this.#throwIfConfigured();
    this.detailCalls += 1;
    return structuredClone(this.detailRows);
  }

  #throwIfConfigured(): void {
    if (this.error) {
      throw this.error;
    }
  }
}

describe("Supabase 공개 게시물 저장소", () => {
  it("published 행을 최신순으로 검증하고 limit+1 커서를 만든다", async () => {
    const posts = getSamplePublishedPosts();
    const dataSource = new FakeDataSource();
    dataSource.listRows = posts.slice(0, 3).map(toListRow);
    const repository = new SupabasePublishedPostRepository(dataSource);

    const page = await repository.list({ limit: 2 });

    expect(dataSource.lastListInput).toEqual({ limit: 3, after: undefined });
    expect(page.items.map((post) => post.id)).toEqual([
      "post-20260812",
      "post-20260811",
    ]);
    expect(page.nextCursor).not.toBeNull();
    expect(page.items[0]).not.toHaveProperty("status");
  });

  it("잘못됐거나 현재 데이터에 없는 커서는 빈 페이지로 복구한다", async () => {
    const dataSource = new FakeDataSource();
    const repository = new SupabasePublishedPostRepository(dataSource);

    await expect(repository.list({ after: "invalid" })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    const absent = encodePublishedPostCursor({
      publishedAt: "2026-08-12T07:00:00+09:00",
      id: "post-20260812",
    });
    await expect(repository.list({ after: absent })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(dataSource.lastListInput).toBeUndefined();
  });

  it("유효한 커서 행을 확인한 뒤 같은 튜플을 Data API에 전달한다", async () => {
    const post = getSamplePublishedPosts()[0];
    const dataSource = new FakeDataSource();
    dataSource.cursorRows = [toListRow(post)];
    const repository = new SupabasePublishedPostRepository(dataSource);
    const cursor = encodePublishedPostCursor({
      publishedAt: post.publishedAt,
      id: post.id,
    });

    await repository.list({ after: cursor });

    expect(dataSource.lastListInput).toEqual({
      limit: 13,
      after: { publishedAt: post.publishedAt, id: post.id },
    });
  });

  it("비공개 행과 형식이 잘못된 행을 fail-closed로 차단한다", async () => {
    const post = getSamplePublishedPosts()[0];
    const dataSource = new FakeDataSource();
    dataSource.listRows = [{ ...toListRow(post), status: "draft" }];
    const repository = new SupabasePublishedPostRepository(dataSource);

    await expect(repository.list()).rejects.toMatchObject({
      code: "UNPUBLISHED_ROW",
    });

    dataSource.listRows = [{ ...toListRow(post), title: 42 }];
    await expect(repository.list()).rejects.toMatchObject({
      code: "INVALID_CARD_ROW",
    });
  });

  it("Data API의 limit 및 정렬 계약 위반을 감지한다", async () => {
    const posts = getSamplePublishedPosts();
    const dataSource = new FakeDataSource();
    const repository = new SupabasePublishedPostRepository(dataSource);

    dataSource.listRows = Array.from({ length: 14 }, (_, index) =>
      toListRow(posts[index % posts.length]),
    );
    await expect(repository.list()).rejects.toMatchObject({
      code: "QUERY_LIMIT_VIOLATION",
    });

    dataSource.listRows = [toListRow(posts[1]), toListRow(posts[0])];
    await expect(repository.list()).rejects.toMatchObject({
      code: "INVALID_QUERY_ORDER",
    });
  });

  it("slug 단건을 snake_case에서 공개 상세 계약으로 변환한다", async () => {
    const post = getSamplePublishedPosts()[0];
    const dataSource = new FakeDataSource();
    dataSource.detailRows = [toDetailRow(post)];
    const repository = new SupabasePublishedPostRepository(dataSource);

    await expect(repository.getBySlug(post.slug)).resolves.toEqual(post);
    await expect(repository.getBySlug("../draft")).resolves.toBeNull();
    expect(dataSource.detailCalls).toBe(1);
  });

  it("비공개 또는 malformed 상세 행도 공개하지 않는다", async () => {
    const post = getSamplePublishedPosts()[0];
    const dataSource = new FakeDataSource();
    const repository = new SupabasePublishedPostRepository(dataSource);

    dataSource.detailRows = [{ ...toDetailRow(post), status: "withheld" }];
    await expect(repository.getBySlug(post.slug)).rejects.toMatchObject({
      code: "UNPUBLISHED_ROW",
    });

    dataSource.detailRows = [
      { ...toDetailRow(post), one_line_summary: { text: "출처 없음", sourceIds: [] } },
    ];
    await expect(repository.getBySlug(post.slug)).rejects.toMatchObject({
      code: "INVALID_DETAIL_ROW",
    });
  });

  it("중복 slug와 반환 slug 불일치를 데이터 오류로 차단한다", async () => {
    const posts = getSamplePublishedPosts();
    const dataSource = new FakeDataSource();
    const repository = new SupabasePublishedPostRepository(dataSource);

    dataSource.detailRows = [toDetailRow(posts[0]), toDetailRow(posts[0])];
    await expect(repository.getBySlug(posts[0].slug)).rejects.toMatchObject({
      code: "DUPLICATE_SLUG",
    });

    dataSource.detailRows = [toDetailRow(posts[1])];
    await expect(repository.getBySlug(posts[0].slug)).rejects.toMatchObject({
      code: "SLUG_MISMATCH",
    });
  });

  it("Data API 오류를 행·키 내용 없이 안정된 오류로 바꾼다", async () => {
    const dataSource = new FakeDataSource();
    dataSource.error = new Error("secret-key and raw-row-content");
    const repository = new SupabasePublishedPostRepository(dataSource);

    const error = await repository.list().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SupabasePublishedPostDataError);
    expect(error).toMatchObject({ code: "DATA_API_ERROR" });
    expect(String(error)).not.toContain("secret-key");
    expect(String(error)).not.toContain("raw-row-content");
  });
});

describe("Supabase REST Data API 소스", () => {
  it("published 필터, 명시적 컬럼, 최신순, limit과 keyset 조건만 요청한다", async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const dataSource = new SupabaseRestPublishedPostDataSource({
      projectUrl: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_test_key_1234567890",
      fetch: async (input, init) => {
        requests.push({ url: new URL(input.toString()), init });
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await dataSource.listPublishedRows({
      limit: 13,
      after: {
        publishedAt: "2026-08-12T07:00:00+09:00",
        id: "post-20260812",
      },
    });

    const request = requests[0];
    expect(request.url.pathname).toBe("/rest/v1/published_posts");
    expect(request.url.searchParams.get("status")).toBe("eq.published");
    expect(request.url.searchParams.get("order")).toBe(
      "published_at.desc,id.desc",
    );
    expect(request.url.searchParams.get("limit")).toBe("13");
    expect(request.url.searchParams.get("select")).toContain(
      "publication_date_kst",
    );
    expect(request.url.searchParams.get("or")).toBe(
      "(published_at.lt.2026-08-12T07:00:00+09:00,and(published_at.eq.2026-08-12T07:00:00+09:00,id.lt.post-20260812))",
    );
    expect(new Headers(request.init?.headers).get("apikey")).toBe(
      "sb_publishable_test_key_1234567890",
    );
  });

  it("실패 응답의 본문을 노출하지 않고 안정된 오류를 반환한다", async () => {
    const dataSource = new SupabaseRestPublishedPostDataSource({
      projectUrl: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_test_key_1234567890",
      fetch: async () =>
        new Response('{"message":"raw database details"}', { status: 500 }),
    });

    const error = await dataSource
      .findPublishedBySlug("valid-slug")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SupabaseDataApiError);
    expect(error).toMatchObject({ code: "RESPONSE_ERROR" });
    expect(String(error)).not.toContain("raw database details");
  });
});
