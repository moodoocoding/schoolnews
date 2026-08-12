import Link from "next/link";

import styles from "@/styles/gallery.module.css";

const tagline =
  "초등교육의 AI·디지털 변화를 하루 한 편씩 기록합니다.";

export function SiteHeader({ isHome = false }: { isHome?: boolean }) {
  return (
    <header className={styles.siteHeader}>
      {isHome ? (
        <h1 className={styles.siteTitle}>AI 교육, 오늘</h1>
      ) : (
        <Link className={styles.siteBrand} href="/">
          AI 교육, 오늘
        </Link>
      )}
      <p className={styles.tagline}>{tagline}</p>
    </header>
  );
}
