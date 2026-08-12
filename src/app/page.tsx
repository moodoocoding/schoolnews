import Link from "next/link";

import { NewsCard } from "@/components/news-card";
import { SampleContentNotice } from "@/components/sample-content-notice";
import { SiteHeader } from "@/components/site-header";
import {
  isUsingSamplePublishedPosts,
  listPublishedPosts,
} from "@/repositories/published-post.repository";
import styles from "@/styles/gallery.module.css";

type HomePageProps = {
  searchParams: Promise<{ after?: string | string[] }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const parameters = await searchParams;
  const requestedAfter =
    typeof parameters.after === "string" ? parameters.after : undefined;
  const page = await listPublishedPosts({ limit: 12, after: requestedAfter });
  const hasUnusableCursor = parameters.after !== undefined && page.items.length === 0;
  const showSampleNotice = isUsingSamplePublishedPosts();

  return (
    <main className={styles.pageShell} id="main-content" tabIndex={-1}>
      <SiteHeader isHome />
      {showSampleNotice ? <SampleContentNotice /> : null}

      {page.items.length > 0 ? (
        <>
          <section aria-label="날짜별 AI·디지털 교육 기록">
            <div className={styles.gallery}>
              {page.items.map((post) => (
                <NewsCard key={post.id} post={post} />
              ))}
            </div>
          </section>

          {requestedAfter !== undefined || page.nextCursor ? (
            <nav aria-label="뉴스 기록 페이지" className={styles.pagination}>
              {requestedAfter !== undefined ? (
                <Link href="/">최신 기록 보기</Link>
              ) : null}
              {page.nextCursor ? (
                <Link
                  href={{ pathname: "/", query: { after: page.nextCursor } }}
                >
                  이전 기록 보기
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : (
        <section className={styles.emptyState}>
          <h2>
            {hasUnusableCursor
              ? "해당 기록을 불러오지 못했어요"
              : "아직 게시된 기록이 없어요"}
          </h2>
          <p>
            {hasUnusableCursor
              ? "링크가 오래되었거나 올바르지 않을 수 있습니다."
              : "첫 번째 이야기가 준비되면 이곳에 보여드릴게요."}
          </p>
          {hasUnusableCursor ? <Link href="/">최신 기록 보기</Link> : null}
        </section>
      )}
    </main>
  );
}
