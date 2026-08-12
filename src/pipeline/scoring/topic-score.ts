import type { TopicScore } from "../../contracts";

export const TOPIC_SCORE_VERSION = "topic-score-v1";

export const TOPIC_SCORE_WEIGHTS = {
  elementaryRelevance: 30,
  aiDigitalSpecificity: 20,
  reliability: 20,
  novelty: 20,
  socialMeaning: 10,
} as const;

export const TOPIC_SELECTION_THRESHOLDS = {
  total: 70,
  elementaryRelevance: 18,
  aiDigitalSpecificity: 10,
  reliability: 12,
  novelty: 10,
} as const;

export interface TopicSignals {
  elementaryRelevance: number;
  aiDigitalSpecificity: number;
  reliability: number;
  novelty: number;
  socialMeaning: number;
}

export type TopicThresholdName = keyof typeof TOPIC_SELECTION_THRESHOLDS;

export interface TopicThresholdFailure {
  actual: number;
  minimum: number;
  threshold: TopicThresholdName;
}

export interface TopicThresholdResult {
  passed: boolean;
  failures: TopicThresholdFailure[];
}

function assertNormalizedSignal(name: keyof TopicSignals, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} signal must be a finite number between 0 and 1.`);
  }
}

function weightedScore(
  name: keyof TopicSignals,
  signal: number,
  maximum: number,
): number {
  assertNormalizedSignal(name, signal);
  return Math.round(signal * maximum);
}

/**
 * Converts deterministic, normalized (0..1) topic signals into the agreed
 * 30/20/20/20/10 score. Eligibility is intentionally evaluated separately.
 */
export function scoreTopicSignals(signals: Readonly<TopicSignals>): TopicScore {
  const elementaryRelevance = weightedScore(
    "elementaryRelevance",
    signals.elementaryRelevance,
    TOPIC_SCORE_WEIGHTS.elementaryRelevance,
  );
  const aiDigitalSpecificity = weightedScore(
    "aiDigitalSpecificity",
    signals.aiDigitalSpecificity,
    TOPIC_SCORE_WEIGHTS.aiDigitalSpecificity,
  );
  const reliability = weightedScore(
    "reliability",
    signals.reliability,
    TOPIC_SCORE_WEIGHTS.reliability,
  );
  const novelty = weightedScore(
    "novelty",
    signals.novelty,
    TOPIC_SCORE_WEIGHTS.novelty,
  );
  const socialMeaning = weightedScore(
    "socialMeaning",
    signals.socialMeaning,
    TOPIC_SCORE_WEIGHTS.socialMeaning,
  );

  return {
    total:
      elementaryRelevance +
      aiDigitalSpecificity +
      reliability +
      novelty +
      socialMeaning,
    elementaryRelevance,
    aiDigitalSpecificity,
    reliability,
    novelty,
    socialMeaning,
    version: TOPIC_SCORE_VERSION,
  };
}

/** Keeps score calculation independent from the agreed publication thresholds. */
export function evaluateTopicScoreThresholds(
  score: Readonly<TopicScore>,
): TopicThresholdResult {
  const failures = (
    Object.entries(TOPIC_SELECTION_THRESHOLDS) as Array<
      [TopicThresholdName, number]
    >
  ).flatMap(([threshold, minimum]) =>
    score[threshold] < minimum
      ? [{ threshold, minimum, actual: score[threshold] }]
      : [],
  );

  return {
    passed: failures.length === 0,
    failures,
  };
}
