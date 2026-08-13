import {
  sourceRegistryEntrySchema,
  type SourceRegistryEntry,
} from "../../contracts";

export const RSS_COLLECTOR_USER_AGENT =
  "AI-Education-Today-RSS-Collector/0.1 (daily educational news curation)";

const MSIT_PRESS_RELEASE_RSS =
  "https://www.msit.go.kr/user/rss/rss.do?bbsSeqNo=94";
const MSIT_RSS_GUIDE =
  "https://www.msit.go.kr/contents/cont.do?mId=173&mPid=147&sCode=user";
const EC_DIGITAL_STRATEGY_RSS =
  "https://digital-strategy.ec.europa.eu/en/rss.xml";
const EC_LEGAL_NOTICE = "https://commission.europa.eu/legal-notice_en";
const EC_ROBOTS = "https://digital-strategy.ec.europa.eu/robots.txt";

export const RSS_SOURCE_REGISTRY: readonly SourceRegistryEntry[] = Object.freeze([
  sourceRegistryEntrySchema.parse({
    sourceId: "msit-press-release",
    name: "과학기술정보통신부",
    publisherGroupId: "msit",
    provenanceGroupPrefix: "msit",
    collectionType: "rss",
    feedUrl: MSIT_PRESS_RELEASE_RSS,
    siteUrl: "https://www.msit.go.kr/",
    publisherType: "official",
    originType: "primary_document",
    sourceRole: "primary",
    sourceType: "primary",
    authority: "public_authority_direct_fact",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-12T00:00:00+09:00",
    policyReferenceUrls: [MSIT_RSS_GUIDE],
    requestPolicy: {
      timeoutMs: 15_000,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 1_500_000,
      maxItemsPerRun: 50,
      maxRedirects: 3,
    },
    notes:
      "과기정통부 공식 보도자료 RSS입니다. title, link, pubDate와 짧은 description만 수집하고 원문·첨부파일은 저장하지 않습니다. 2026-08-13 실측 9.83초 응답에 유한 여유를 두어 전체 제한을 15초로 고정합니다.",
  }),
  sourceRegistryEntrySchema.parse({
    sourceId: "ec-digital-strategy",
    name: "유럽연합 집행위원회 디지털전략",
    publisherGroupId: "european-commission",
    provenanceGroupPrefix: "european-commission-digital-strategy",
    collectionType: "rss",
    feedUrl: EC_DIGITAL_STRATEGY_RSS,
    siteUrl: "https://digital-strategy.ec.europa.eu/",
    publisherType: "official",
    originType: "primary_document",
    // This is an institutionally independent source relative to Korean
    // ministries, not a claim that it is independent journalism.
    sourceRole: "independent",
    sourceType: "research",
    authority: "public_authority_direct_fact",
    locale: "en",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-13T13:30:00+09:00",
    policyReferenceUrls: [EC_LEGAL_NOTICE, EC_ROBOTS],
    requestPolicy: {
      timeoutMs: 15_000,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 500_000,
      maxItemsPerRun: 25,
      maxRedirects: 3,
    },
    notes:
      "유럽연합 집행위원회 공식 디지털전략 RSS입니다. EU 소유 텍스트는 별도 표시가 없으면 CC BY 4.0이며 출처·변경 표시 조건으로 재사용할 수 있습니다. title, link, pubDate와 ecl teaser 설명만 수집하고 이미지·캡션·전체 HTML은 저장하지 않습니다.",
  }),
]);
