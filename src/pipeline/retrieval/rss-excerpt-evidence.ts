import { createHash } from "node:crypto";

import {
  evidenceItemSchema,
  graphemeLength,
  type EvidenceItem,
  type NormalizedArticle,
  type SourceRegistryEntry,
} from "../../contracts";
import {
  validateArticleSources,
  type ValidatedArticleSource,
} from "./validated-article-sources";

export const RSS_EXCERPT_LOCATOR = "RSS 요약";
export const NEWS_SEARCH_EXCERPT_LOCATOR = "뉴스 검색 API 요약";
export const RSS_EXCERPT_MIN_GRAPHEMES = 40;
export const RSS_EXCERPT_MAX_GRAPHEMES = 800;

const graphemeSegmenter = new Intl.Segmenter("ko", {
  granularity: "grapheme",
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeCharacterReferences(value: string): string {
  const namedReferences: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]+));/gi,
    (
      reference,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      named: string | undefined,
    ) => {
      if (decimal || hexadecimal) {
        const codePoint = Number.parseInt(
          decimal ?? hexadecimal ?? "",
          decimal ? 10 : 16,
        );
        if (
          Number.isInteger(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return String.fromCodePoint(codePoint);
        }
        return " ";
      }
      return namedReferences[named?.toLowerCase() ?? ""] ?? reference;
    },
  );
}

function truncateGraphemes(value: string, maximum: number): string {
  if (graphemeLength(value) <= maximum) {
    return value;
  }

  return Array.from(graphemeSegmenter.segment(value))
    .slice(0, maximum)
    .map((part) => part.segment)
    .join("")
    .trim();
}

/** Converts an RSS description to bounded plain text; it is never trusted HTML. */
export function sanitizeRssExcerpt(excerpt: string): string {
  const withoutExecutableContent = excerpt
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  const plainText = decodeCharacterReferences(withoutExecutableContent)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

  return truncateGraphemes(plainText, RSS_EXCERPT_MAX_GRAPHEMES);
}

function createEvidenceFromValidatedPair(
  pair: Readonly<ValidatedArticleSource>,
): EvidenceItem | null {
  const excerpt = pair.article.excerpt;
  if (!excerpt) {
    return null;
  }

  const passage = sanitizeRssExcerpt(excerpt);
  if (graphemeLength(passage) < RSS_EXCERPT_MIN_GRAPHEMES) {
    return null;
  }

  const locator =
    pair.source.collectionType === "api"
      ? NEWS_SEARCH_EXCERPT_LOCATOR
      : RSS_EXCERPT_LOCATOR;
  const namespace = pair.source.collectionType === "api" ? "search" : "rss";
  const passageHash = sha256(passage);
  const identityHash = sha256(
    `${pair.article.articleId}\n${locator}\n${passageHash}`,
  );
  const evidence: EvidenceItem = {
    evidenceId: `evidence:${namespace}:${identityHash.slice(0, 32)}`,
    articleId: pair.article.articleId,
    passageId: `passage:${namespace}:${identityHash.slice(0, 32)}`,
    passageHash,
    sourceId: pair.source.sourceId,
    publisherGroupId: pair.source.publisherGroupId,
    provenanceGroupKey: pair.article.provenanceGroupKey,
    sourceRole: pair.source.sourceRole,
    sourceType: pair.source.sourceType,
    // An RSS summary is a discovery aid, not a verified direct passage from
    // the primary document. It must never unlock the single-source exception.
    authority: "none",
    sourceName: pair.source.name,
    title: pair.article.title,
    url: pair.article.canonicalUrl,
    publishedAt: pair.article.publishedAt,
    publishedAtPrecision: pair.article.publishedAtPrecision,
    passage,
    locator,
  };

  return evidenceItemSchema.parse(evidence);
}

export function createRssExcerptEvidenceItem(
  article: Readonly<NormalizedArticle>,
  source: Readonly<SourceRegistryEntry>,
): EvidenceItem | null {
  const [pair] = validateArticleSources([article], [source]);
  return createEvidenceFromValidatedPair(pair);
}

export function createRssExcerptEvidenceItems(input: {
  articles: readonly NormalizedArticle[];
  sourceRegistryEntries: readonly SourceRegistryEntry[];
}): EvidenceItem[] {
  return validateArticleSources(
    input.articles,
    input.sourceRegistryEntries,
  ).flatMap((pair) => {
    const evidence = createEvidenceFromValidatedPair(pair);
    return evidence ? [evidence] : [];
  });
}
