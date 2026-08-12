import styles from "@/styles/gallery.module.css";

export function SampleContentNotice() {
  return (
    <aside
      aria-label="개발용 콘텐츠 안내"
      className={styles.sampleNotice}
    >
      <strong>개발용 샘플</strong>
      <span>
        현재 글과 출처는 화면 검증을 위한 예시이며 실제 뉴스가 아닙니다.
      </span>
    </aside>
  );
}
