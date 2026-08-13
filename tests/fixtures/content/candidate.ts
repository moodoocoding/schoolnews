import type {
  NormalizedArticle,
  SourceRegistryEntry,
} from "../../../src/contracts";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

export function candidateSource(
  overrides: Partial<SourceRegistryEntry> = {},
): SourceRegistryEntry {
  return {
    sourceId: "source-msit",
    name: "과학기술정보통신부",
    publisherGroupId: "publisher-msit",
    provenanceGroupPrefix: "origin-msit",
    collectionType: "rss",
    feedUrl: "https://example.go.kr/rss/press.xml",
    siteUrl: "https://example.go.kr",
    publisherType: "official",
    originType: "primary_document",
    sourceRole: "primary",
    sourceType: "primary",
    authority: "public_authority_direct_fact",
    contentUse: "evidence",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-10T09:00:00+09:00",
    policyReferenceUrls: ["https://example.go.kr/policy/rss"],
    requestPolicy: {
      timeoutMs: 5_000,
      minIntervalMs: 60_000,
      maxResponseBytes: 500_000,
      maxItemsPerRun: 30,
      maxRedirects: 2,
    },
    notes: "테스트용 공개 RSS 등록부 항목입니다.",
    ...overrides,
  };
}

export function candidateArticle(
  source: SourceRegistryEntry = candidateSource(),
  overrides: Partial<NormalizedArticle> = {},
): NormalizedArticle {
  return {
    sourceId: source.sourceId,
    externalId: "press-2026-0812",
    originalUrl: "https://example.go.kr/press/2026-0812",
    title: "초등학교 AI 디지털 교육 개인정보 보호 지침 발표",
    excerpt:
      "과학기술정보통신부는 초등학교 수업에서 AI 디지털 교육 서비스를 사용할 때 개인정보와 안전을 확인하도록 하는 지침을 발표했다.",
    author: null,
    publisher: source.name,
    publishedAt: "2026-08-11T09:00:00+09:00",
    publishedAtPrecision: "instant",
    discoveredAt: "2026-08-11T09:05:00+09:00",
    articleId: "article-msit-0812",
    publisherGroupId: source.publisherGroupId,
    provenanceGroupKey: `${source.provenanceGroupPrefix}:press-2026-0812`,
    canonicalUrl: "https://example.go.kr/press/2026-0812",
    canonicalUrlHash: hashA,
    normalizedTitle: "초등학교 ai 디지털 교육 개인정보 보호 지침 발표",
    contentFingerprint: hashB,
    canonicalizationVersion: "canonical-url-v1",
    fingerprintVersion: "content-fingerprint-v1",
    originType: source.originType,
    ...overrides,
  };
}
