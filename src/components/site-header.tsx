import Link from "next/link";

import styles from "@/styles/gallery.module.css";

const tagline =
  "초등교육의 AI·디지털 변화를 하루 한 편씩 기록합니다.";

export function SiteHeader({ isHome = false }: { isHome?: boolean }) {
  return (
    <header className={styles.siteHeader}>
      <div className={styles.brandRow}>
        <span aria-hidden="true" className={styles.brandMark}>
          AI
        </span>
        {isHome ? (
          <h1 className={styles.siteTitle}>AI 교육, 오늘</h1>
        ) : (
          <Link className={styles.siteBrand} href="/">
            AI 교육, 오늘
          </Link>
        )}
        <span className={styles.dailyBadge}>매일 한 편</span>
      </div>
      <p className={styles.tagline}>
        {tagline}
        <span className={styles.taglineNote}>학생 · 교사 · 학부모가 함께 읽어요.</span>
      </p>
    </header>
  );
}
