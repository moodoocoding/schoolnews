import { describe, expect, it } from "vitest";

import {
  sourceRegistryEntrySchema,
  type ArticleInput,
  type SourceRegistryEntry,
} from "../../src/contracts";
import { RSS_SOURCE_REGISTRY } from "../../src/pipeline/collectors";
import { normalizeArticle } from "../../src/pipeline/normalize";
import {
  selectDailyTopic,
} from "../../src/pipeline/orchestrator";
import { createRssExcerptEvidenceItems } from "../../src/pipeline/retrieval";

const primarySource = RSS_SOURCE_REGISTRY[0];
const independentSource: SourceRegistryEntry = sourceRegistryEntrySchema.parse({
  ...primarySource,
  sourceId: "independent-education-news",
  name: "독립교육뉴스",
  publisherGroupId: "independent-education-news",
  provenanceGroupPrefix: "independent-report",
  feedUrl: "https://news.example.org/rss.xml",
  siteUrl: "https://news.example.org/",
  publisherType: "news",
  originType: "original_reporting",
  sourceRole: "independent",
  sourceType: "news",
  authority: "none",
  policyReferenceUrls: ["https://news.example.org/rss-policy"],
});

function inputFor(
  source: SourceRegistryEntry,
  overrides: Partial<ArticleInput> = {},
): ArticleInput {
  return {
    sourceId: source.sourceId,
    externalId: `${source.sourceId}-001`,
    originalUrl: `${source.siteUrl}article/ai-school-privacy`,
    title: "초등학교 AI 디지털 교육 개인정보 보호 지침 발표",
    excerpt:
      "초등학교 수업에서 인공지능 서비스를 사용할 때 학생의 개인정보와 안전을 확인하는 지침이 발표됐습니다.",
    author: null,
    publisher: source.name,
    publishedAt: "2026-08-13T00:00:00+09:00",
    publishedAtPrecision: "date",
    discoveredAt: "2026-08-13T06:00:00+09:00",
    ...overrides,
  };
}

function materials(sources: readonly SourceRegistryEntry[]) {
  const articles = sources.map((source) =>
    normalizeArticle(inputFor(source), source),
  );
  return {
    articles,
    evidenceItems: createRssExcerptEvidenceItems({
      articles,
      sourceRegistryEntries: sources,
    }),
    sources,
  };
}

describe("M5 결정론적 오늘의 주제 선정", () => {
  it("즉시 모드는 기본 적격 후보라도 높은 82점 기준 전에는 보류한다", () => {
    const base = materials([primarySource, independentSource]);
    const deadline = selectDailyTopic({ ...base, publicationMode: "deadline" });
    expect(deadline.status).toBe("selected");
    if (deadline.status !== "selected") return;
    const immediate = selectDailyTopic({ ...base, publicationMode: "immediate" });
    expect(immediate.status).toBe(
      deadline.candidate.score.total >= 82 && deadline.candidate.score.socialMeaning >= 6
        ? "selected"
        : "none",
    );
  });
  it("국내 복수 언론의 기술 뉴스는 교육 단어가 없어도 교육 영향 후보가 된다", () => {
    const secondIndependentSource: SourceRegistryEntry =
      sourceRegistryEntrySchema.parse({
        ...independentSource,
        sourceId: "second-tech-news",
        name: "두번째기술뉴스",
        publisherGroupId: "second-tech-news",
        provenanceGroupPrefix: "second-tech-report",
        feedUrl: "https://second.example.org/rss.xml",
        siteUrl: "https://second.example.org/",
        policyReferenceUrls: ["https://second.example.org/rss-policy"],
      });
    const first = normalizeArticle(
      inputFor(independentSource, {
        title: "AI 에이전트가 개인정보 판단을 대신하는 시대",
        excerpt:
          "AI 에이전트가 개인정보를 조회해 자동 의사결정을 수행하면서 신뢰와 책임 문제가 제기됐다.",
      }),
      independentSource,
    );
    const second = normalizeArticle(
      inputFor(secondIndependentSource, {
        title: "개인정보 판단 맡은 AI 에이전트, 책임은 누구에게",
        excerpt:
          "자동 의사결정에 쓰이는 AI 에이전트가 개인정보와 저작권을 어떻게 다뤄야 하는지 논의가 이어졌다.",
      }),
      secondIndependentSource,
    );
    const articles = [first, second];
    const sources = [independentSource, secondIndependentSource];
    const result = selectDailyTopic({
      articles,
      evidenceItems: createRssExcerptEvidenceItems({
        articles,
        sourceRegistryEntries: sources,
      }),
      sources,
    });

    expect(result.status).toBe("selected");
    expect(result.status === "selected" && result.candidate.evidencePolicy).toBe(
      "two_independent_sources",
    );
  });

  it("점수가 높아도 공식 RSS 한 곳뿐이면 생성 전에 보류한다", () => {
    const result = selectDailyTopic(materials([primarySource]));

    expect(result.status).toBe("none");
    expect(result.assessedGroupCount).toBe(1);
  });

  it("관련 공식 자료와 독립 보도가 함께 있을 때만 한 주제를 선정한다", () => {
    const result = selectDailyTopic(
      materials([primarySource, independentSource]),
    );

    expect(result.status).toBe("selected");
    expect(result.status === "selected" && result.candidate.evidencePolicy).toBe(
      "primary_plus_independent",
    );
    expect(
      result.status === "selected" &&
        result.candidate.independence.hasPrimaryAndIndependent,
    ).toBe(true);
    expect(result.status === "selected" && result.evidenceItems).toHaveLength(2);
  });

  it("국내 독립 보도라도 다른 사건이면 공식 자료와 합치지 않는다", () => {
    const articles = [
      normalizeArticle(inputFor(primarySource), primarySource),
      normalizeArticle(
        inputFor(independentSource, {
          originalUrl: `${independentSource.siteUrl}news/university-supercomputer`,
          title: "대학 슈퍼컴퓨터 연구 지원 확대",
          excerpt: "대학 고성능 컴퓨팅 연구 사업에 새로운 지원 계획이 발표됐습니다.",
        }),
        independentSource,
      ),
    ];
    const result = selectDailyTopic({
      articles,
      evidenceItems: createRssExcerptEvidenceItems({
        articles,
        sourceRegistryEntries: [primarySource, independentSource],
      }),
      sources: [primarySource, independentSource],
    });

    expect(result.status).toBe("none");
    expect(result.assessedGroupCount).toBe(2);
  });

  it("입력 순서가 바뀌어도 같은 주제를 선택한다", () => {
    const forward = selectDailyTopic(
      materials([primarySource, independentSource]),
    );
    const reverseMaterials = materials([independentSource, primarySource]);
    const reverse = selectDailyTopic({
      ...reverseMaterials,
      articles: [...reverseMaterials.articles].reverse(),
      evidenceItems: [...reverseMaterials.evidenceItems].reverse(),
    });

    expect(forward.status).toBe("selected");
    expect(reverse.status).toBe("selected");
    expect(reverse).toEqual(forward);
  });

  it("간접 유사성 사슬로 서로 다른 기사를 한 사건처럼 합치지 않는다", () => {
    const bridgeSource: SourceRegistryEntry = sourceRegistryEntrySchema.parse({
      ...independentSource,
      sourceId: "bridge-education-news",
      name: "연결교육뉴스",
      publisherGroupId: "bridge-education-news",
      provenanceGroupPrefix: "bridge-report",
      feedUrl: "https://bridge.example.org/rss.xml",
      siteUrl: "https://bridge.example.org/",
      policyReferenceUrls: ["https://bridge.example.org/rss-policy"],
    });
    const articles = [
      normalizeArticle(inputFor(primarySource), primarySource),
      normalizeArticle(
        inputFor(bridgeSource, {
          title: "초등학교 AI 디지털 교육 교사 연수 지침 발표",
        }),
        bridgeSource,
      ),
      normalizeArticle(
        inputFor(independentSource, {
          title: "교사 연수 지침 발표와 학교 업무 경감 안내",
        }),
        independentSource,
      ),
    ];
    const result = selectDailyTopic({
      articles,
      evidenceItems: createRssExcerptEvidenceItems({
        articles,
        sourceRegistryEntries: [
          primarySource,
          bridgeSource,
          independentSource,
        ],
      }),
      sources: [primarySource, bridgeSource, independentSource],
    });

    expect(result.assessedGroupCount).toBe(2);
    const selectedArticleIds =
      result.status === "selected" ? result.candidate.articleIds : [];
    expect(
      selectedArticleIds.includes(articles[0].articleId) &&
        selectedArticleIds.includes(articles[2].articleId),
    ).toBe(false);
  });

  it("서로 다른 사건은 독립 출처 수를 합쳐 통과시키지 않는다", () => {
    const primary = normalizeArticle(inputFor(primarySource), primarySource);
    const independent = normalizeArticle(
      inputFor(independentSource, {
        originalUrl: `${independentSource.siteUrl}article/coding-event`,
        title: "지역 대학생 코딩 경진대회 참가자 모집",
        excerpt:
          "지역 대학이 대학생을 대상으로 코딩 경진대회 참가자를 모집하고 행사 일정을 안내했습니다.",
      }),
      independentSource,
    );
    const articles = [primary, independent];
    const result = selectDailyTopic({
      articles,
      evidenceItems: createRssExcerptEvidenceItems({
        articles,
        sourceRegistryEntries: [primarySource, independentSource],
      }),
      sources: [primarySource, independentSource],
    });

    expect(result.status).toBe("none");
    expect(result.assessedGroupCount).toBe(2);
  });
});
