import Link from "next/link";

import type { PublishedPostCard } from "@/contracts";
import styles from "@/styles/archive.module.css";

import { formatPublicationDate } from "./presentation";

export function ArchivePostCard({ post }: { post: PublishedPostCard }) {
  return (
    <article className={styles.archiveCard}>
      <Link
        aria-label={`${post.title} 이전 기록 읽기`}
        className={styles.archiveCardLink}
        href={`/archive/${post.slug}`}
      >
        <time
          className={styles.archiveDate}
          dateTime={post.publicationDateKst}
        >
          {formatPublicationDate(post.publicationDateKst)}
        </time>
        <div className={styles.archiveCopy}>
          <h2>{post.title}</h2>
          <p>{post.summary}</p>
        </div>
        <span aria-hidden="true" className={styles.archiveArrow}>
          →
        </span>
      </Link>
    </article>
  );
}
