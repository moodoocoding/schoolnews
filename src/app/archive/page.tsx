import type { Metadata } from "next";
import Link from "next/link";

import { ArchivePostCard } from "@/components/archive-post-card";
import { SiteHeader } from "@/components/site-header";
import { listArchivedPosts } from "@/repositories/archived-post.repository";
import archiveStyles from "@/styles/archive.module.css";
import galleryStyles from "@/styles/gallery.module.css";

export const metadata: Metadata = {
  title: "이전 기록",
  description: "개편 전에 발행한 AI·디지털 교육 기록을 보존한 아카이브입니다.",
};

type ArchivePageProps = {
  searchParams: Promise<{ after?: string | string[] }>;
};

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  const parameters = await searchParams;
  const requestedAfter =
    typeof parameters.after === "string" ? parameters.after : undefined;
  const page = await listArchivedPosts({ limit: 12, after: requestedAfter });
  const hasUnusableCursor = parameters.after !== undefined && page.items.length === 0;

  return (
    <main className={galleryStyles.pageShell} id="main-content" tabIndex={-1}>
      <SiteHeader />

      <header className={archiveStyles.archiveIntro}>
        <p className={archiveStyles.archiveEyebrow}>ARCHIVE</p>
        <h1>이전 기록</h1>
        <p>
          개편 전에 발행한 글을 그대로 보존했습니다. 현재의 편집 기준과는
          다를 수 있지만, AI·디지털 교육을 바라보는 시선이 어떻게 다듬어져
          왔는지 살펴볼 수 있습니다.
        </p>
      </header>

      {page.items.length > 0 ? (
        <>
          <section aria-label="개편 전 발행 기록">
            <ol className={archiveStyles.archiveList}>
              {page.items.map((post) => (
                <li className={archiveStyles.archiveListItem} key={post.id}>
                  <ArchivePostCard post={post} />
                </li>
              ))}
            </ol>
          </section>

          {requestedAfter !== undefined || page.nextCursor ? (
            <nav aria-label="아카이브 페이지" className={galleryStyles.pagination}>
              {requestedAfter !== undefined ? (
                <Link href="/archive">최신 아카이브 보기</Link>
              ) : null}
              {page.nextCursor ? (
                <Link
                  href={{ pathname: "/archive", query: { after: page.nextCursor } }}
                >
                  더 오래된 기록 보기
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : (
        <section className={archiveStyles.emptyArchive}>
          <h2>
            {hasUnusableCursor
              ? "해당 기록을 불러오지 못했어요"
              : "보존된 이전 기록이 아직 없어요"}
          </h2>
          <p>
            {hasUnusableCursor
              ? "링크가 오래되었거나 올바르지 않을 수 있습니다."
              : "이전 발행본을 보존하면 이곳에 차분히 모아 보여드릴게요."}
          </p>
          {hasUnusableCursor ? <Link href="/archive">첫 기록으로</Link> : null}
        </section>
      )}
    </main>
  );
}
