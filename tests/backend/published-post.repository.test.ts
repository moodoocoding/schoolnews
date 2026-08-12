import { describe, expect, it } from "vitest";

import {
  publishedPostDetailSchema,
  publishedPostPageSchema,
} from "../../src/contracts";
import {
  getPublishedPostBySlug,
  listPublishedPosts,
} from "../../src/repositories";

describe("공개 게시물 인메모리 저장소", () => {
  it("최신순으로 기본 12건과 다음 커서를 반환한다", async () => {
    const page = await listPublishedPosts();

    expect(publishedPostPageSchema.safeParse(page).success).toBe(true);
    expect(page.items).toHaveLength(12);
    expect(page.nextCursor).not.toBeNull();
    expect(page.items[0].publicationDateKst).toBe("2026-08-12");

    for (let index = 1; index < page.items.length; index += 1) {
      const previous = page.items[index - 1];
      const current = page.items[index];
      const timestampOrder =
        Date.parse(previous.publishedAt) - Date.parse(current.publishedAt);

      expect(timestampOrder).toBeGreaterThanOrEqual(0);
      if (timestampOrder === 0) {
        expect(previous.id > current.id).toBe(true);
      }
    }
  });

  it("페이지 크기를 최대 12건으로 제한한다", async () => {
    const page = await listPublishedPosts({ limit: 100 });

    expect(page.items).toHaveLength(12);
  });

  it("불투명 커서로 중복 없이 다음 기록을 조회한다", async () => {
    const firstPage = await listPublishedPosts({ limit: 5 });
    const secondPage = await listPublishedPosts({
      limit: 5,
      after: firstPage.nextCursor ?? undefined,
    });
    const firstIds = new Set(firstPage.items.map((post) => post.id));

    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.items).toHaveLength(5);
    expect(secondPage.items.every((post) => !firstIds.has(post.id))).toBe(true);
    expect(secondPage.items[0].publicationDateKst).toBe("2026-08-07");
  });

  it("잘못됐거나 현재 데이터에 없는 커서는 안전한 빈 결과로 처리한다", async () => {
    await expect(
      listPublishedPosts({ after: "not-a-valid-cursor" }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      listPublishedPosts({ after: "djEKMjAyNi0wMS0wMVQwMDowMDowMCswOTowMAptaXNzaW5n" }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("모든 샘플 상세가 공개 계약을 통과하고 비공개 상태를 노출하지 않는다", async () => {
    const cards = [];
    let after: string | undefined;

    do {
      const page = await listPublishedPosts({ after });
      cards.push(...page.items);
      after = page.nextCursor ?? undefined;
    } while (after !== undefined);

    expect(cards.length).toBeGreaterThanOrEqual(12);
    for (const card of cards) {
      expect("status" in card).toBe(false);
      const detail = await getPublishedPostBySlug(card.slug);
      expect(publishedPostDetailSchema.safeParse(detail).success).toBe(true);
      expect(detail && "status" in detail).toBe(false);
    }
  });

  it("없는 slug와 형식이 잘못된 slug는 null을 반환한다", async () => {
    await expect(getPublishedPostBySlug("missing-post")).resolves.toBeNull();
    await expect(getPublishedPostBySlug("../draft-post")).resolves.toBeNull();
  });

  it("반환값을 바꿔도 저장소의 원본 데이터는 바뀌지 않는다", async () => {
    const firstPage = await listPublishedPosts({ limit: 1 });
    const originalTitle = firstPage.items[0].title;
    firstPage.items[0].title = "외부에서 바꾼 제목";
    firstPage.items[0].visual.seed = "external-change-seed";

    const firstDetail = await getPublishedPostBySlug(firstPage.items[0].slug);
    expect(firstDetail).not.toBeNull();
    if (firstDetail) {
      firstDetail.body[0].claims[0].text = "외부에서 바꾼 본문";
    }

    const nextPage = await listPublishedPosts({ limit: 1 });
    const nextDetail = await getPublishedPostBySlug(nextPage.items[0].slug);

    expect(nextPage.items[0].title).toBe(originalTitle);
    expect(nextPage.items[0].visual.seed).not.toBe("external-change-seed");
    expect(nextDetail?.body[0].claims[0].text).not.toBe("외부에서 바꾼 본문");
  });
});
