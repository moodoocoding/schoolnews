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
]);
