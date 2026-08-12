import type {
  PublishedPostDetail,
  PublishedSource,
} from "@/contracts";
import styles from "@/styles/article.module.css";

import { CitationLinks } from "./citation-links";
import { formatPublicationDate } from "./presentation";

function SourceMetadata({ source }: { source: PublishedSource }) {
  return (
    <span className={styles.sourceMetadata}>
      {source.publisher}
      <span aria-hidden="true"> · </span>
      {source.publishedDate
        ? formatPublicationDate(source.publishedDate)
        : "발행일 미상"}
    </span>
  );
}

export function PublishedPostArticle({ post }: { post: PublishedPostDetail }) {
  return (
    <article className={styles.article}>
      <header className={styles.articleHeader}>
        <time className={styles.articleDate} dateTime={post.publicationDateKst}>
          {formatPublicationDate(post.publicationDateKst)}
        </time>
        <h1 className={styles.articleTitle}>{post.title}</h1>
      </header>

      <section aria-labelledby="one-line-summary" className={styles.leadSection}>
        <h2 id="one-line-summary">오늘의 한 줄 요약</h2>
        <p>
          {post.oneLineSummary.text}
          <CitationLinks
            sourceIds={post.oneLineSummary.sourceIds}
            sources={post.sources}
          />
        </p>
      </section>

      <section aria-labelledby="what-happened" className={styles.section}>
        <h2 id="what-happened">무슨 일이 있었나요?</h2>
        <div className={styles.prose}>
          {post.body.map((paragraph, paragraphIndex) => (
            <p key={`${post.id}-paragraph-${paragraphIndex + 1}`}>
              {paragraph.claims.map((claim, claimIndex) => (
                <span key={`${post.id}-claim-${paragraphIndex}-${claimIndex}`}>
                  {claimIndex > 0 ? " " : null}
                  {claim.text}
                  <CitationLinks
                    sourceIds={claim.sourceIds}
                    sources={post.sources}
                  />
                </span>
              ))}
            </p>
          ))}
        </div>
      </section>

      <section aria-labelledby="questions" className={styles.section}>
        <h2 id="questions">함께 생각해 볼 질문</h2>
        <ul className={styles.questionList}>
          {post.questions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sources" className={styles.sourceSection}>
        <h2 id="sources">참고 기사와 출처</h2>
        <ol className={styles.sourceList}>
          {post.sources.map((source, index) => {
            const sourceNumber = index + 1;

            return (
              <li id={`source-${sourceNumber}`} key={source.id}>
                <a
                  href={source.originalUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {source.title}
                  <span className={styles.newWindowHint}> (새 창)</span>
                </a>
                <SourceMetadata source={source} />
              </li>
            );
          })}
        </ol>
      </section>
    </article>
  );
}
