import Link from "next/link";

import type { PublishedPostCard } from "@/contracts";
import styles from "@/styles/gallery.module.css";

import { PatternVisual } from "./pattern-visual";
import { formatPublicationDate } from "./presentation";

export function NewsCard({ post }: { post: PublishedPostCard }) {
  return (
    <article className={styles.card}>
      <Link
        aria-label={`${post.title} 글 읽기`}
        className={styles.cardLink}
        href={`/news/${post.slug}`}
      >
        <PatternVisual visual={post.visual} />
        <div className={styles.cardBody}>
          <time
            className={styles.cardDate}
            dateTime={post.publicationDateKst}
          >
            {formatPublicationDate(post.publicationDateKst)}
          </time>
          <h2 className={styles.cardTitle}>{post.title}</h2>
          <p className={styles.cardSummary}>{post.summary}</p>
        </div>
      </Link>
    </article>
  );
}
