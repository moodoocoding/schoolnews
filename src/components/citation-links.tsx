import type { PublishedSource } from "@/contracts";
import styles from "@/styles/article.module.css";

import { getCitationNumbers } from "./presentation";

export function CitationLinks({
  sourceIds,
  sources,
}: {
  sourceIds: readonly string[];
  sources: readonly PublishedSource[];
}) {
  const citationNumbers = getCitationNumbers(
    sourceIds,
    sources.map((source) => source.id),
  );

  if (citationNumbers.length === 0) {
    return null;
  }

  return (
    <sup className={styles.citations}>
      {citationNumbers.map((citationNumber) => (
        <a
          aria-label={`출처 ${citationNumber}번으로 이동`}
          href={`#source-${citationNumber}`}
          key={citationNumber}
        >
          [{citationNumber}]
        </a>
      ))}
    </sup>
  );
}
