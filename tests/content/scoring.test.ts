import { describe, expect, it } from "vitest";

import {
  evaluateTopicScoreThresholds,
  scoreTopicSignals,
} from "../../src/pipeline/scoring";

describe("결정론적 주제 점수", () => {
  it("30/20/20/20/10 가중치를 적용한다", () => {
    expect(
      scoreTopicSignals({
        elementaryRelevance: 1,
        aiDigitalSpecificity: 1,
        reliability: 1,
        novelty: 1,
        socialMeaning: 1,
      }),
    ).toEqual({
      total: 100,
      elementaryRelevance: 30,
      aiDigitalSpecificity: 20,
      reliability: 20,
      novelty: 20,
      socialMeaning: 10,
      version: "topic-score-v1",
    });
  });

  it("항목별 점수를 반올림하고 총점을 더한다", () => {
    const score = scoreTopicSignals({
      elementaryRelevance: 26 / 30,
      aiDigitalSpecificity: 18 / 20,
      reliability: 16 / 20,
      novelty: 14 / 20,
      socialMeaning: 8 / 10,
    });

    expect(score.total).toBe(82);
    expect(score.elementaryRelevance).toBe(26);
  });

  it("점수 계산과 선정 임계값 판정을 분리한다", () => {
    const result = evaluateTopicScoreThresholds({
      total: 71,
      elementaryRelevance: 17,
      aiDigitalSpecificity: 20,
      reliability: 11,
      novelty: 13,
      socialMeaning: 10,
      version: "topic-score-v1",
    });

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.threshold)).toEqual([
      "elementaryRelevance",
      "reliability",
    ]);
  });

  it("정규화 범위 밖의 입력을 거부한다", () => {
    expect(() =>
      scoreTopicSignals({
        elementaryRelevance: 1.01,
        aiDigitalSpecificity: 1,
        reliability: 1,
        novelty: 1,
        socialMeaning: 1,
      }),
    ).toThrow(RangeError);
  });
});
