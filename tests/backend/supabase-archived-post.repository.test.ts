import { describe, expect, it } from "vitest";

import type { PublishedPostDetail } from "../../src/contracts";
import {
  ORIGINAL_AUGUST_ARCHIVE_KEY,
  SupabaseRestArchivedPostDataSource,
} from "../../src/db/supabase/archived-post.data-source";
import type {
  SupabasePublishedPostDataSource,
  SupabasePublishedPostRow,
} from "../../src/db/supabase/published-post.data-source";
import { getSamplePublishedPosts } from "../../src/repositories/published-post.samples";
import { SupabaseArchivedPostRepository } from "../../src/repositories/supabase-archived-post.repository";

function detailRow(post: PublishedPostDetail): SupabasePublishedPostRow {
  return {
    id: post.id,
    slug: post.slug,
    status: "published",
    publication_date_kst: post.publicationDateKst,
    published_at: post.publishedAt,
    modified_at: post.modifiedAt,
    title: post.title,
    summary: post.summary,
    visual: post.visual,
    one_line_summary: post.oneLineSummary,
    body: post.body,
    questions: post.questions,
    sources: post.sources,
  };
}

class FakeArchiveDataSource implements SupabasePublishedPostDataSource {
  detailRows: SupabasePublishedPostRow[] = [];
  listRows: SupabasePublishedPostRow[] = [];
  async findPublishedCursor(): Promise<SupabasePublishedPostRow[]> {
    return [];
  }
  async listPublishedRows(): Promise<SupabasePublishedPostRow[]> {
    return this.listRows;
  }
  async findPublishedBySlug(): Promise<SupabasePublishedPostRow[]> {
    return this.detailRows;
  }
}

describe("Supabase 게시물 아카이브 저장소", () => {
  it("기존 공개 상세 계약으로 snapshot을 검증해 반환한다", async () => {
    const post = getSamplePublishedPosts()[0];
    const source = new FakeArchiveDataSource();
    source.detailRows = [detailRow(post)];
    const repository = new SupabaseArchivedPostRepository(source);

    await expect(repository.getBySlug(post.slug)).resolves.toEqual(post);
  });

  it("아카이브 key, published 상태와 별도 endpoint를 항상 고정한다", async () => {
    const requests: URL[] = [];
    const source = new SupabaseRestArchivedPostDataSource({
      projectUrl: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_test_key_1234567890",
      fetch: async (input) => {
        requests.push(new URL(input.toString()));
        return Response.json([]);
      },
    });

    await source.listPublishedRows({ limit: 13 });

    expect(requests[0].pathname).toBe("/rest/v1/published_post_archive");
    expect(requests[0].searchParams.get("archive_key")).toBe(
      `eq.${ORIGINAL_AUGUST_ARCHIVE_KEY}`,
    );
    expect(requests[0].searchParams.get("status")).toBe("eq.published");
    expect(requests[0].searchParams.get("order")).toBe(
      "published_at.desc,original_post_id.desc",
    );
    expect(requests[0].searchParams.get("select")).toContain(
      "id:original_post_id",
    );
  });
});
