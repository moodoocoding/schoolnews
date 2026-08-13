import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PublishedPostArticle } from "@/components/published-post-article";
import { SiteHeader } from "@/components/site-header";
import { getArchivedPostBySlug } from "@/repositories/archived-post.repository";
import archiveStyles from "@/styles/archive.module.css";
import galleryStyles from "@/styles/gallery.module.css";

type ArchiveDetailPageProps = {
  params: Promise<{ slug: string }>;
};

const getArchivedPost = cache(getArchivedPostBySlug);

export async function generateMetadata({
  params,
}: ArchiveDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getArchivedPost(slug);

  if (!post) {
    return { title: "이전 기록을 찾을 수 없습니다" };
  }

  return {
    title: `${post.title} — 이전 기록`,
    description: post.summary,
  };
}

export default async function ArchiveDetailPage({
  params,
}: ArchiveDetailPageProps) {
  const { slug } = await params;
  const post = await getArchivedPost(slug);

  if (!post) {
    notFound();
  }

  return (
    <main className={galleryStyles.pageShell} id="main-content" tabIndex={-1}>
      <SiteHeader />
      <nav aria-label="이전 기록 탐색" className={archiveStyles.archiveBackNavigation}>
        <Link href="/archive">← 이전 기록 목록</Link>
        <Link href="/">현재 글 보기</Link>
      </nav>
      <p className={archiveStyles.archiveContext}>
        <strong>개편 전 발행본입니다.</strong> 당시의 글과 출처를 그대로
        보존했으며, 현재 편집 기준으로 다시 쓰지 않았습니다.
      </p>
      <PublishedPostArticle post={post} />
    </main>
  );
}
