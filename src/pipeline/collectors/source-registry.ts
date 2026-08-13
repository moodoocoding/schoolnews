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
const KEDI_PRESS_RELEASE_RSS =
  "https://www.kedi.re.kr/khome/main/announce/rssAnnounceData.do?board_sq_no=3";
const KEDI_RSS_GUIDE =
  "https://www.kedi.re.kr/khome/main/guide/useRss.do";
const KISA_PRESS_RELEASE_RSS = "https://www.kisa.or.kr/rss/402";
const KISA_RSS_GUIDE = "https://www.kisa.or.kr/702";
const MOHW_PRESS_RELEASE_RSS =
  "https://www.mohw.go.kr/rss/board.es?mid=a10503000000&bid=0027";
const MOHW_RSS_GUIDE = "https://www.mohw.go.kr/menu.es?mid=a10807000000";
const KR_CERT_GUIDE_RSS =
  "https://www.boho.or.kr/kr/rss.do?bbsId=B0000127";
const KR_CERT_RSS_GUIDE =
  "https://krcert.or.kr/kr/subPage.do?menuNo=205121";
const KOCCA_RESEARCH_RSS =
  "https://www.kocca.kr/xml/knowledge/research/rss.xml";
const KOCCA_RSS_GUIDE =
  "https://www.kocca.kr/kocca/subPage.do?menuNo=204917";
const NEWSIS_TECH_RSS = "https://www.newsis.com/RSS/health.xml";
const NEWSIS_RSS_GUIDE = "https://www.newsis.com/RSS/";

export type RssSourceReviewRecord = Readonly<{
  organization: string;
  status: "enabled" | "not_enabled";
  reason: string;
  reviewedAt: string;
  referenceUrls: readonly string[];
}>;

export const RSS_SOURCE_REVIEW_RECORDS: readonly RssSourceReviewRecord[] =
  Object.freeze([
    {
      organization: "교육부",
      status: "not_enabled",
      reason: "공식 보도자료 목록은 확인했으나 공개 RSS/API 주소를 확인하지 못했습니다.",
      reviewedAt: "2026-08-13",
      referenceUrls: ["https://www.moe.go.kr/boardCnts/listRenew.do?boardID=316"],
    },
    {
      organization: "한국교육학술정보원",
      status: "not_enabled",
      reason: "공식 보도자료 목록은 확인했으나 공개 RSS/API 주소와 이용 안내를 확인하지 못했습니다.",
      reviewedAt: "2026-08-13",
      referenceUrls: ["https://www.keris.or.kr/"],
    },
    {
      organization: "개인정보보호위원회",
      status: "not_enabled",
      reason: "공식 보도자료 게시판은 확인했으나 공개 RSS/API 주소를 확인하지 못했습니다.",
      reviewedAt: "2026-08-13",
      referenceUrls: ["https://www.pipc.go.kr/"],
    },
    {
      organization: "한국지능정보사회진흥원",
      status: "not_enabled",
      reason: "공식 보도자료 목록은 확인했으나 공개 RSS/API 주소를 확인하지 못했습니다.",
      reviewedAt: "2026-08-13",
      referenceUrls: ["https://nia.or.kr/site/nia_kor/ex/bbs/List.do?cbIdx=90549"],
    },
    {
      organization: "IT동아",
      status: "not_enabled",
      reason: "공식 RSS는 확인했지만 robots.txt가 /feeds/ 수집을 명시적으로 차단합니다.",
      reviewedAt: "2026-08-13",
      referenceUrls: [
        "https://it.donga.com/rss/",
        "https://it.donga.com/robots.txt",
      ],
    },
  ]);

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
    contentUse: "evidence",
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
    sourceId: "kedi-press-release",
    name: "한국교육개발원",
    publisherGroupId: "kedi",
    provenanceGroupPrefix: "kedi",
    collectionType: "rss",
    feedUrl: KEDI_PRESS_RELEASE_RSS,
    siteUrl: "https://www.kedi.re.kr/",
    publisherType: "official",
    originType: "primary_document",
    sourceRole: "primary",
    sourceType: "primary",
    authority: "public_authority_direct_fact",
    contentUse: "evidence",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-13T00:00:00+09:00",
    policyReferenceUrls: [KEDI_RSS_GUIDE],
    requestPolicy: {
      timeoutMs: 15_000,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 500_000,
      maxItemsPerRun: 50,
      maxRedirects: 1,
    },
    notes:
      "한국교육개발원이 공식 RSS 안내 페이지에서 제공하는 보도자료 피드입니다. RSS의 짧은 description만 근거 후보로 저장하며 원문과 첨부파일은 저장하지 않습니다. 피드가 같은 공식 호스트의 http 링크를 제공하는 경우에만 https로 승격합니다.",
  }),
  sourceRegistryEntrySchema.parse({
    sourceId: "kisa-press-release",
    name: "한국인터넷진흥원",
    publisherGroupId: "kisa",
    provenanceGroupPrefix: "kisa",
    collectionType: "rss",
    feedUrl: KISA_PRESS_RELEASE_RSS,
    siteUrl: "https://www.kisa.or.kr/",
    publisherType: "official",
    originType: "primary_document",
    sourceRole: "primary",
    sourceType: "primary",
    authority: "public_authority_direct_fact",
    contentUse: "discovery_only",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-13T00:00:00+09:00",
    policyReferenceUrls: [KISA_RSS_GUIDE],
    requestPolicy: {
      timeoutMs: 15_000,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 100_000,
      maxItemsPerRun: 50,
      maxRedirects: 1,
    },
    notes:
      "한국인터넷진흥원이 RSS 안내 페이지에서 홈페이지·블로그 구독용으로 제공하는 보도자료 피드입니다. 피드에는 description이 없어 discovery_only로 제목·링크·날짜만 저장하며 생성 근거, 원문과 첨부파일은 저장하지 않습니다. 같은 공식 호스트의 http 링크만 https로 승격합니다.",
  }),
  sourceRegistryEntrySchema.parse({
    sourceId: "mohw-press-release",
    name: "보건복지부",
    publisherGroupId: "mohw",
    provenanceGroupPrefix: "mohw",
    collectionType: "rss",
    feedUrl: MOHW_PRESS_RELEASE_RSS,
    siteUrl: "https://www.mohw.go.kr/",
    publisherType: "official",
    originType: "primary_document",
    sourceRole: "primary",
    sourceType: "primary",
    authority: "public_authority_direct_fact",
    contentUse: "evidence",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-14T00:00:00+09:00",
    policyReferenceUrls: [MOHW_RSS_GUIDE],
    requestPolicy: {
      timeoutMs: 15_000,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 200_000,
      maxItemsPerRun: 50,
      maxRedirects: 1,
    },
    notes:
      "보건복지부 공식 정보구독 페이지가 제공하고 robots.txt가 명시적으로 허용하는 보도자료 RSS입니다. 아동·디지털 웰빙·접근성 관련 직접 사실의 짧은 RSS 설명만 근거 후보로 저장합니다.",
  }),
  sourceRegistryEntrySchema.parse({
    sourceId: "krcert-report-guide",
    name: "KISA 보호나라",
    publisherGroupId: "kisa",
    provenanceGroupPrefix: "kisa",
    collectionType: "rss",
    feedUrl: KR_CERT_GUIDE_RSS,
    siteUrl: "https://www.boho.or.kr/",
    publisherType: "official",
    originType: "primary_document",
    sourceRole: "primary",
    sourceType: "primary",
    authority: "public_authority_direct_fact",
    contentUse: "evidence",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-14T00:00:00+09:00",
    policyReferenceUrls: [KR_CERT_RSS_GUIDE],
    requestPolicy: {
      timeoutMs: 15_000,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 100_000,
      maxItemsPerRun: 50,
      maxRedirects: 1,
    },
    notes:
      "KISA 보호나라의 공식 RSS 안내가 제공하는 보고서·가이드 피드입니다. 학교 보안과 개인정보 관련 직접 사실을 발견하고 짧은 RSS 설명만 근거 후보로 저장합니다.",
  }),
  sourceRegistryEntrySchema.parse({
    sourceId: "kocca-research",
    name: "한국콘텐츠진흥원",
    publisherGroupId: "kocca",
    provenanceGroupPrefix: "kocca",
    collectionType: "rss",
    feedUrl: KOCCA_RESEARCH_RSS,
    siteUrl: "https://www.kocca.kr/",
    publisherType: "research",
    originType: "primary_document",
    sourceRole: "primary",
    sourceType: "research",
    authority: "none",
    contentUse: "evidence",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-14T00:00:00+09:00",
    policyReferenceUrls: [KOCCA_RSS_GUIDE],
    requestPolicy: {
      timeoutMs: 15_000,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 100_000,
      maxItemsPerRun: 50,
      maxRedirects: 1,
    },
    notes:
      "한국콘텐츠진흥원 공식 RSS 안내가 제공하는 연구보고서 피드입니다. 미디어·콘텐츠 기술의 교육 영향을 찾되 연구 결론을 공공기관 직접 사실 권위로 승격하지 않습니다.",
  }),
  sourceRegistryEntrySchema.parse({
    sourceId: "newsis-tech-rss",
    name: "뉴시스 IT·바이오",
    publisherGroupId: "newsis",
    provenanceGroupPrefix: "newsis-rss",
    collectionType: "rss",
    feedUrl: NEWSIS_TECH_RSS,
    siteUrl: "https://www.newsis.com/",
    publisherType: "wire",
    originType: "wire",
    sourceRole: "supporting",
    sourceType: "news",
    authority: "none",
    contentUse: "discovery_only",
    locale: "ko-KR",
    enabled: true,
    accessStatus: "allowed",
    accessReviewedAt: "2026-08-14T00:00:00+09:00",
    policyReferenceUrls: [NEWSIS_RSS_GUIDE],
    requestPolicy: {
      timeoutMs: 15_000,
      minIntervalMs: 86_400_000,
      maxResponseBytes: 500_000,
      maxItemsPerRun: 50,
      maxRedirects: 1,
    },
    notes:
      "뉴시스 공식 IT·바이오 RSS입니다. 통신사 기사이므로 제목·링크·발행시각만 발견 정보로 저장하며 description, 본문, 독립 출처 점수에는 사용하지 않습니다.",
  }),
]);
