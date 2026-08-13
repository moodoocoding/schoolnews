import { describe, expect, it } from "vitest";

import {
  deriveTopicSignals,
  evaluateTopicScoreThresholds,
  scoreTopicSignals,
} from "../../src/pipeline/scoring";
import {
  candidateArticle,
  candidateSource,
} from "../fixtures/content/candidate";

describe("발행 전 결정론적 주제 신호", () => {
  it("초등만 언급한 일반 뉴스에는 AI·디지털 신호를 주지 않는다", () => {
    const source = candidateSource();
    const article = candidateArticle(source, {
      title: "초등학교 운동장 안전 점검 실시",
      normalizedTitle: "초등학교 운동장 안전 점검 실시",
      excerpt:
        "새 학기를 앞두고 초등학교 운동 시설과 통학로를 확인하는 정기 안전 점검이 실시됐다.",
    });

    const signals = deriveTopicSignals({
      articles: [article],
      sourceRegistryEntries: [source],
    });

    expect(signals.elementaryRelevance).toBeGreaterThanOrEqual(0.9);
    expect(signals.aiDigitalSpecificity).toBe(0);
    expect(signals.socialMeaning).toBe(0);
    expect(evaluateTopicScoreThresholds(scoreTopicSignals(signals)).passed).toBe(
      false,
    );
  });

  it("교육 연결점이 없는 단순 AI 산업 실적 뉴스는 낮게 제한한다", () => {
    const source = candidateSource();
    const article = candidateArticle(source, {
      title: "생성형 AI 반도체 수출 확대",
      normalizedTitle: "생성형 ai 반도체 수출 확대",
      excerpt:
        "기업들은 생성형 AI 반도체 생산량과 해외 수출을 늘리기 위한 새로운 투자 계획을 발표했다.",
    });

    const signals = deriveTopicSignals({
      articles: [article],
      sourceRegistryEntries: [source],
    });

    expect(signals.elementaryRelevance).toBe(0);
    expect(signals.aiDigitalSpecificity).toBeLessThanOrEqual(0.25);
    expect(signals.socialMeaning).toBe(0);
  });

  it("교육 단어가 없어도 사회적 판단을 바꾸는 디지털 기술은 교육 영향 후보가 된다", () => {
    const source = candidateSource();
    const article = candidateArticle(source, {
      title: "휴머노이드 로봇이 사람의 판단을 대신하는 시대",
      normalizedTitle: "휴머노이드 로봇이 사람의 판단을 대신하는 시대",
      excerpt:
        "AI 로봇의 자동 의사결정과 감시, 개인정보, 노동의 변화에 대한 사회적 논의가 커지고 있다.",
    });

    const signals = deriveTopicSignals({
      articles: [article],
      sourceRegistryEntries: [source],
    });

    expect(signals.elementaryRelevance).toBeGreaterThanOrEqual(0.6);
    expect(signals.aiDigitalSpecificity).toBeGreaterThanOrEqual(0.6);
    expect(signals.socialMeaning).toBeGreaterThanOrEqual(0.6);
  });

  it("교육을 직접 언급하지 않아도 디지털 기술과 사람의 문제가 함께 있으면 교육 영향 후보로 본다", () => {
    const source = candidateSource();
    const article = candidateArticle(source, {
      title: "AI 에이전트가 개인정보를 대신 판단하는 시대",
      normalizedTitle: "ai 에이전트가 개인정보를 대신 판단하는 시대",
      excerpt:
        "새 AI 에이전트가 개인정보를 조회해 자동 의사결정을 수행하면서 저작권과 신뢰 문제도 함께 제기됐다.",
    });

    const signals = deriveTopicSignals({
      articles: [article],
      sourceRegistryEntries: [source],
    });

    expect(signals.elementaryRelevance).toBeGreaterThanOrEqual(0.6);
    expect(signals.aiDigitalSpecificity).toBeGreaterThanOrEqual(0.6);
    expect(signals.socialMeaning).toBeGreaterThanOrEqual(0.6);
  });

  it("같은 publisher group의 피드 두 건을 독립 출처 가산으로 세지 않는다", () => {
    const firstSource = candidateSource({
      publisherType: "news",
      originType: "original_reporting",
      sourceRole: "independent",
      sourceType: "news",
      authority: "none",
    });
    const secondSource = candidateSource({
      sourceId: "source-msit-policy",
      name: "과학기술정보통신부 정책소식",
      feedUrl: "https://example.go.kr/rss/policy.xml",
      publisherType: "news",
      originType: "original_reporting",
      sourceRole: "independent",
      sourceType: "news",
      authority: "none",
    });
    const firstArticle = candidateArticle(firstSource);
    const secondArticle = candidateArticle(secondSource, {
      articleId: "article-msit-policy-0812",
      externalId: "policy-2026-0812",
      originalUrl: "https://example.go.kr/policy/2026-0812",
      canonicalUrl: "https://example.go.kr/policy/2026-0812",
      canonicalUrlHash: "c".repeat(64),
      contentFingerprint: "d".repeat(64),
      provenanceGroupKey: "origin-msit:policy-2026-0812",
    });

    const oneFeed = deriveTopicSignals({
      articles: [firstArticle],
      sourceRegistryEntries: [firstSource],
    });
    const sameOwnerFeeds = deriveTopicSignals({
      articles: [firstArticle, secondArticle],
      sourceRegistryEntries: [firstSource, secondSource],
    });

    expect(sameOwnerFeeds.reliability).toBe(oneFeed.reliability);
  });

  it("동일 지문과 유사한 과거 제목의 새로움을 결정론적으로 낮춘다", () => {
    const source = candidateSource();
    const article = candidateArticle(source);
    const baseInput = {
      articles: [article],
      sourceRegistryEntries: [source],
    };

    const repeatedFingerprint = deriveTopicSignals({
      ...baseInput,
      previousContentFingerprints: [article.contentFingerprint],
    });
    const similarTitle = deriveTopicSignals({
      ...baseInput,
      previousPostTitles: ["초등학교 AI 디지털 교육 개인정보 보호 지침 공개"],
    });

    expect(repeatedFingerprint.novelty).toBe(0);
    expect(similarTitle.novelty).toBeLessThanOrEqual(0.25);
    expect(
      deriveTopicSignals({
        ...baseInput,
        previousPostTitles: ["초등학교 AI 디지털 교육 개인정보 보호 지침 공개"],
      }),
    ).toEqual(similarTitle);
  });

  it("기사와 등록부가 불일치하거나 metadata가 잘못되면 점수를 반환하지 않는다", () => {
    const source = candidateSource();
    const mismatchedArticle = candidateArticle(source, {
      publisherGroupId: "publisher-other",
    });
    const invalidSource = candidateSource({ locale: "ko-kr" });

    expect(() =>
      deriveTopicSignals({
        articles: [mismatchedArticle],
        sourceRegistryEntries: [source],
      }),
    ).toThrow(/publisherGroupId/);
    expect(() =>
      deriveTopicSignals({
        articles: [candidateArticle(invalidSource)],
        sourceRegistryEntries: [invalidSource],
      }),
    ).toThrow(/메타데이터/);
  });
});
