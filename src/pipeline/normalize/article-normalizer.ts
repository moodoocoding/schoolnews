import { createHash } from "node:crypto";

import {
  articleInputSchema,
  fetchableSourceUrlSchema,
  normalizedArticleSchema,
  sourceRegistryEntrySchema,
  type ArticleInput,
  type NormalizedArticle,
  type SourceRegistryEntry,
} from "../../contracts";

export const CANONICALIZATION_VERSION = "canonical-url-v1";
export const FINGERPRINT_VERSION = "content-fingerprint-v1";

const TRACKING_PARAMETERS = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "referrer",
  "yclid",
]);

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isTrackingParameter(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.startsWith("utm_") || TRACKING_PARAMETERS.has(normalized);
}

export function canonicalizeArticleUrl(value: string): string {
  const parsed = fetchableSourceUrlSchema.parse(value);
  const url = new URL(parsed);
  url.hash = "";
  url.username = "";
  url.password = "";

  const parameters = Array.from(url.searchParams.entries())
    .filter(([name]) => !isTrackingParameter(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameOrder = leftName.localeCompare(rightName, "en");
      return nameOrder !== 0
        ? nameOrder
        : leftValue.localeCompare(rightValue, "en");
    });
  url.search = "";
  for (const [name, parameterValue] of parameters) {
    url.searchParams.append(name, parameterValue);
  }

  return url.toString();
}

export function normalizeArticleTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArticle(
  input: ArticleInput,
  sourceInput: SourceRegistryEntry,
): NormalizedArticle {
  const article = articleInputSchema.parse(input);
  const source = sourceRegistryEntrySchema.parse(sourceInput);
  if (article.sourceId !== source.sourceId) {
    throw new Error("기사 sourceId와 수집원 sourceId가 일치하지 않습니다.");
  }

  const canonicalUrl = canonicalizeArticleUrl(article.originalUrl);
  const canonicalUrlHash = sha256(canonicalUrl);
  const normalizedTitle = normalizeArticleTitle(article.title);
  if (normalizedTitle.length === 0) {
    throw new Error("정규화 후 제목이 비어 있습니다.");
  }

  const contentFingerprint = sha256(
    [source.publisherGroupId, normalizedTitle].join("\n"),
  );
  const provenanceSeed = article.externalId ?? canonicalUrl;
  const provenanceGroupKey = `${source.provenanceGroupPrefix}:${sha256(
    `${source.publisherGroupId}\n${provenanceSeed}`,
  ).slice(0, 32)}`;

  return normalizedArticleSchema.parse({
    ...article,
    articleId: `article:${canonicalUrlHash}`,
    publisherGroupId: source.publisherGroupId,
    provenanceGroupKey,
    canonicalUrl,
    canonicalUrlHash,
    normalizedTitle,
    contentFingerprint,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION,
    originType: source.originType,
  });
}
