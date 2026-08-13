import {
  getPublicationDateKst,
  publicationDateKstSchema,
  type EvidenceItem,
  type NormalizedArticle,
} from "../../contracts";

export const EDITORIAL_SOURCE_LAG_DAYS = 2;
export const EDITORIAL_SOURCE_DATE_VERSION = "editorial-source-date-v1";

export function getEditorialSourceDateKst(runDate: string): string {
  const parsed = publicationDateKstSchema.parse(runDate);
  const [year, month, day] = parsed.split("-").map(Number);
  const sourceDate = new Date(
    Date.UTC(year, month - 1, day - EDITORIAL_SOURCE_LAG_DAYS),
  );
  return sourceDate.toISOString().slice(0, 10);
}

/**
 * A daily edition published on D only considers articles published on D-2 in
 * Asia/Seoul. Evidence must point to one of those articles and carry the same
 * KST publication day. All other collected feed items remain archival input
 * but cannot reach topic selection or generation for this edition.
 */
export function selectEditorialSourceDateMaterials(input: {
  runDate: string;
  articles: readonly NormalizedArticle[];
  evidenceItems: readonly EvidenceItem[];
}): {
  sourceDateKst: string;
  articles: NormalizedArticle[];
  evidenceItems: EvidenceItem[];
} {
  const sourceDateKst = getEditorialSourceDateKst(input.runDate);
  const articles = input.articles.filter(
    (article) => getPublicationDateKst(article.publishedAt) === sourceDateKst,
  );
  const articleIds = new Set(articles.map((article) => article.articleId));
  const evidenceItems = input.evidenceItems.filter(
    (item) =>
      articleIds.has(item.articleId) &&
      getPublicationDateKst(item.publishedAt) === sourceDateKst,
  );
  return {
    sourceDateKst,
    articles: structuredClone(articles),
    evidenceItems: structuredClone(evidenceItems),
  };
}
