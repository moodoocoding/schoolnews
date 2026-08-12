"use client";

import styles from "@/styles/gallery.module.css";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className={styles.pageShell} id="main-content" tabIndex={-1}>
      <section className={styles.emptyState}>
        <h1>잠시 후 다시 보여드릴게요</h1>
        <p>기록을 불러오는 동안 문제가 생겼습니다.</p>
        <button onClick={() => reset()} type="button">
          다시 시도
        </button>
      </section>
    </main>
  );
}
