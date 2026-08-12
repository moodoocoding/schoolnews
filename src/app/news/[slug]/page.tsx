import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PublishedPostArticle } from "@/components/published-post-article";
import { SampleContentNotice } from "@/components/sample-content-notice";
import { SiteHeader } from "@/components/site-header";
import {
  getPublishedPostBySlug,
  isUsingSamplePublishedPosts,
} from "@/repositories/published-post.repository";
import articleStyles from "@/styles/article.module.css";
import galleryStyles from "@/styles/gallery.module.css";

type NewsDetailPageProps = {
  params: Promise<{ slug: string }>;
};

const getPost = cache(getPublishedPostBySlug);

export async function generateMetadata({
  params,
}: NewsDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    return { title: "기록을 찾을 수 없습니다" };
  }

  return {
    title: post.title,
    description: post.summary,
  };
}

export default async function NewsDetailPage({ params }: NewsDetailPageProps) {
  const { slug } = await params;
  const post = await getPost(slug);
  const showSampleNotice = isUsingSamplePublishedPosts();

  if (!post) {
    notFound();
  }

  return (
    <main className={galleryStyles.pageShell} id="main-content" tabIndex={-1}>
      <SiteHeader />
      {showSampleNotice ? <SampleContentNotice /> : null}
      <nav aria-label="기록 탐색" className={articleStyles.backNavigation}>
        <Link href="/">← 갤러리로 돌아가기</Link>
      </nav>
      <PublishedPostArticle post={post} />
    </main>
  );
}
