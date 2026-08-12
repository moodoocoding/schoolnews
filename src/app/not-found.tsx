import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import styles from "@/styles/gallery.module.css";

export default function NotFound() {
  return (
    <main className={styles.pageShell} id="main-content" tabIndex={-1}>
      <SiteHeader />
      <section className={styles.emptyState}>
        <p className={styles.statusCode}>404</p>
        <h1>기록을 찾을 수 없어요</h1>
        <p>주소가 바뀌었거나 공개되지 않은 글일 수 있습니다.</p>
        <Link href="/">최신 기록 보기</Link>
      </section>
    </main>
  );
}
