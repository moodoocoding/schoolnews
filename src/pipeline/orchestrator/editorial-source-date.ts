import {
  getPublicationDateKst,
  publicationDateKstSchema,
  type EvidenceItem,
  type NormalizedArticle,
} from "../../contracts";

export const EDITORIAL_ROLLING_WINDOW_DAYS = 7;
export const EDITORIAL_FRESH_WINDOW_DAYS = 1;
export const EDITORIAL_SOURCE_DATE_VERSION = "editorial-rolling-window-v2";

function shiftKstDate(value: string, days: number): string {
  const parsed = publicationDateKstSchema.parse(value);
  const [year, month, day] = parsed.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function getEditorialWindowKst(input: {
  runDate: string;
  windowDays: number;
}): { startDateKst: string; endDateExclusiveKst: string } {
  if (!Number.isInteger(input.windowDays) || input.windowDays < 1 || input.windowDays > 7) {
    throw new RangeError("Editorial window must be between one and seven days.");
  }
  const endDateExclusiveKst = publicationDateKstSchema.parse(input.runDate);
  return {
    startDateKst: shiftKstDate(endDateExclusiveKst, -input.windowDays),
    endDateExclusiveKst,
  };
}

/**
 * The 03:00 KST run only evaluates completed calendar days. Normal runs use
 * yesterday; the seven-day deadline compares all completed days since the
 * previous week. Evidence must stay attached to an article in the same window.
 */
export function selectEditorialWindowMaterials(input: {
  runDate: string;
  windowDays: number;
  articles: readonly NormalizedArticle[];
  evidenceItems: readonly EvidenceItem[];
}): {
  startDateKst: string;
  endDateExclusiveKst: string;
  articles: NormalizedArticle[];
  evidenceItems: EvidenceItem[];
} {
  const window = getEditorialWindowKst(input);
  const articles = input.articles.filter((article) => {
    const date = getPublicationDateKst(article.publishedAt);
    return date >= window.startDateKst && date < window.endDateExclusiveKst;
  });
  const articleIds = new Set(articles.map((article) => article.articleId));
  const evidenceItems = input.evidenceItems.filter((item) => {
    const date = getPublicationDateKst(item.publishedAt);
    return (
      articleIds.has(item.articleId) &&
      date >= window.startDateKst &&
      date < window.endDateExclusiveKst
    );
  });
  return {
    ...window,
    articles: structuredClone(articles),
    evidenceItems: structuredClone(evidenceItems),
  };
}
