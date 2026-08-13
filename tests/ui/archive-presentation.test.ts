import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("아카이브 표현", () => {
  it("이전 발행본을 현재 글과 혼동하지 않게 설명한다", () => {
    const listPage = readSource("src/app/archive/page.tsx");
    const detailPage = readSource("src/app/archive/[slug]/page.tsx");

    expect(listPage).toContain("개편 전에 발행한 글을 그대로 보존했습니다");
    expect(detailPage).toContain("개편 전 발행본입니다");
    expect(detailPage).toContain("현재 편집 기준으로 다시 쓰지 않았습니다");
  });

  it("메인 헤더에 최소한의 이전 기록 동선을 제공한다", () => {
    const header = readSource("src/components/site-header.tsx");

    expect(header).toContain('aria-label="주요 탐색"');
    expect(header).toContain('href="/archive"');
    expect(header).toContain("이전 기록");
  });

  it("아카이브 카드는 날짜·제목·요약만 표시한다", () => {
    const card = readSource("src/components/archive-post-card.tsx");

    expect(card).toContain("formatPublicationDate");
    expect(card).toContain("post.title");
    expect(card).toContain("post.summary");
    expect(card).not.toContain("PatternVisual");
  });
});
