import type {
  NormalizedArticle,
  SourceRegistryEntry,
} from "../../contracts";
import { validateArticleSources } from "../retrieval";
import type { TopicSignals } from "./topic-score";

export const TOPIC_SIGNAL_VERSION = "topic-signals-v1";

interface WeightedKeyword {
  phrase: string;
  weight: number;
}

/** Explicit Korean-first taxonomy. Changes require a version bump and fixtures. */
export const TOPIC_KEYWORD_TAXONOMY = {
  elementary: [
    { phrase: "초등학교", weight: 1 },
    { phrase: "초등학생", weight: 1 },
    { phrase: "초등교사", weight: 0.95 },
    { phrase: "초등 교사", weight: 0.95 },
    { phrase: "초등교육", weight: 0.95 },
    { phrase: "초등 수업", weight: 0.9 },
    { phrase: "초등 학부모", weight: 0.9 },
    { phrase: "초등", weight: 0.75 },
    { phrase: "학부모", weight: 0.35 },
    { phrase: "교사", weight: 0.3 },
    { phrase: "학생", weight: 0.25 },
    { phrase: "학교", weight: 0.2 },
    { phrase: "어린이", weight: 0.35 },
  ] satisfies readonly WeightedKeyword[],
  aiDigital: [
    { phrase: "AI 디지털교과서", weight: 1 },
    { phrase: "AI 디지털 교과서", weight: 1 },
    { phrase: "인공지능 디지털교과서", weight: 1 },
    { phrase: "생성형 AI 교육", weight: 0.95 },
    { phrase: "AI 교육", weight: 0.9 },
    { phrase: "인공지능 교육", weight: 0.9 },
    { phrase: "AI 튜터", weight: 0.9 },
    { phrase: "AI 코스웨어", weight: 0.9 },
    { phrase: "디지털교과서", weight: 0.85 },
    { phrase: "디지털 교과서", weight: 0.85 },
    { phrase: "디지털 교육", weight: 0.8 },
    { phrase: "디지털 학습", weight: 0.75 },
    { phrase: "디지털 리터러시", weight: 0.7 },
    { phrase: "미디어 리터러시", weight: 0.65 },
    { phrase: "에듀테크", weight: 0.7 },
    { phrase: "코딩 교육", weight: 0.6 },
    { phrase: "생성형 AI", weight: 0.65 },
    { phrase: "챗GPT", weight: 0.65 },
    { phrase: "인공지능", weight: 0.55 },
    { phrase: "AI", weight: 0.55 },
    { phrase: "LLM", weight: 0.45 },
    { phrase: "디지털 전환", weight: 0.45 },
  ] satisfies readonly WeightedKeyword[],
  educationContext: [
    { phrase: "교육", weight: 0.7 },
    { phrase: "수업", weight: 0.7 },
    { phrase: "학습", weight: 0.65 },
    { phrase: "교실", weight: 0.65 },
    { phrase: "교사", weight: 0.6 },
    { phrase: "학생", weight: 0.55 },
    { phrase: "학교", weight: 0.55 },
    { phrase: "학부모", weight: 0.5 },
    { phrase: "교과서", weight: 0.65 },
    { phrase: "교육부", weight: 0.75 },
    { phrase: "교육청", weight: 0.7 },
  ] satisfies readonly WeightedKeyword[],
  nonElementaryContext: [
    { phrase: "중학교", weight: 1 },
    { phrase: "고등학교", weight: 1 },
    { phrase: "대학생", weight: 1 },
    { phrase: "대학", weight: 1 },
  ] satisfies readonly WeightedKeyword[],
  socialMeaning: [
    { phrase: "정책", weight: 0.65 },
    { phrase: "지침", weight: 0.7 },
    { phrase: "시행", weight: 0.65 },
    { phrase: "도입", weight: 0.55 },
    { phrase: "전국", weight: 0.6 },
    { phrase: "예산", weight: 0.55 },
    { phrase: "법안", weight: 0.75 },
    { phrase: "개인정보", weight: 0.8 },
    { phrase: "저작권", weight: 0.75 },
    { phrase: "안전", weight: 0.65 },
    { phrase: "윤리", weight: 0.65 },
    { phrase: "격차", weight: 0.8 },
    { phrase: "접근성", weight: 0.7 },
    { phrase: "공정성", weight: 0.7 },
    { phrase: "영향", weight: 0.55 },
    { phrase: "확대", weight: 0.5 },
    { phrase: "금지", weight: 0.6 },
  ] satisfies readonly WeightedKeyword[],
} as const;

export interface DeriveTopicSignalsInput {
  articles: readonly NormalizedArticle[];
  sourceRegistryEntries: readonly SourceRegistryEntry[];
  previousPostTitles?: readonly string[];
  previousContentFingerprints?: readonly string[];
}

function clampSignal(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 1_000;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  const containsAscii = /[a-z0-9]/.test(normalizedPhrase);
  return containsAscii
    ? ` ${text} `.includes(` ${normalizedPhrase} `)
    : text.includes(normalizedPhrase);
}

function keywordSignal(
  text: string,
  taxonomy: readonly WeightedKeyword[],
): number {
  const matches = taxonomy
    .filter((keyword) => includesPhrase(text, keyword.phrase))
    .map((keyword) => keyword.weight)
    .sort((left, right) => right - left);

  if (matches.length === 0) {
    return 0;
  }

  return clampSignal(
    matches[0] + Math.min(0.15, (matches.length - 1) * 0.03),
  );
}

function articleText(article: Readonly<NormalizedArticle>): string {
  return normalizeText(
    [article.title, article.normalizedTitle, article.excerpt ?? ""].join(" "),
  );
}

function deriveKeywordSignals(
  articles: readonly NormalizedArticle[],
): Pick<
  TopicSignals,
  "elementaryRelevance" | "aiDigitalSpecificity" | "socialMeaning"
> {
  let elementaryRelevance = 0;
  let aiDigitalSpecificity = 0;
  let socialMeaning = 0;

  for (const article of articles) {
    const text = articleText(article);
    let elementary = keywordSignal(
      text,
      TOPIC_KEYWORD_TAXONOMY.elementary,
    );
    const nonElementary = keywordSignal(
      text,
      TOPIC_KEYWORD_TAXONOMY.nonElementaryContext,
    );
    if (nonElementary > 0 && !includesPhrase(text, "초등")) {
      elementary = Math.min(elementary, 0.15);
    }

    const educationContext = keywordSignal(
      text,
      TOPIC_KEYWORD_TAXONOMY.educationContext,
    );
    let aiDigital = keywordSignal(
      text,
      TOPIC_KEYWORD_TAXONOMY.aiDigital,
    );
    if (aiDigital > 0 && educationContext === 0) {
      aiDigital = Math.min(aiDigital, 0.25);
    } else if (aiDigital > 0) {
      aiDigital = clampSignal(aiDigital + educationContext * 0.1);
    }

    const social = keywordSignal(
      text,
      TOPIC_KEYWORD_TAXONOMY.socialMeaning,
    );
    const gatedSocial =
      elementary > 0 && aiDigital > 0
        ? clampSignal(social * Math.min(1, (elementary + aiDigital) / 1.2))
        : 0;

    elementaryRelevance = Math.max(elementaryRelevance, elementary);
    aiDigitalSpecificity = Math.max(aiDigitalSpecificity, aiDigital);
    socialMeaning = Math.max(socialMeaning, gatedSocial);
  }

  return { elementaryRelevance, aiDigitalSpecificity, socialMeaning };
}

function sourceReliability(source: Readonly<SourceRegistryEntry>): number {
  const publisherScore: Readonly<
    Record<SourceRegistryEntry["publisherType"], number>
  > = {
    official: 0.9,
    research: 0.86,
    news: 0.72,
    wire: 0.66,
    other: 0.4,
  };
  const originAdjustment: Readonly<
    Record<SourceRegistryEntry["originType"], number>
  > = {
    primary_document: 0.07,
    original_reporting: 0.08,
    wire: 0,
    press_release_rewrite: -0.16,
    unknown: -0.14,
  };
  const roleAdjustment: Readonly<
    Record<SourceRegistryEntry["sourceRole"], number>
  > = {
    primary: 0.04,
    independent: 0.05,
    supporting: 0,
  };
  const authorityAdjustment =
    source.authority === "public_authority_direct_fact" ? 0.08 : 0;

  return clampSignal(
    publisherScore[source.publisherType] +
      originAdjustment[source.originType] +
      roleAdjustment[source.sourceRole] +
      authorityAdjustment,
  );
}

function deriveReliability(
  articleSources: ReturnType<typeof validateArticleSources>,
): number {
  const bestByPublisherGroup = new Map<string, number>();
  for (const { source } of articleSources) {
    const reliability = sourceReliability(source);
    bestByPublisherGroup.set(
      source.publisherGroupId,
      Math.max(
        bestByPublisherGroup.get(source.publisherGroupId) ?? 0,
        reliability,
      ),
    );
  }

  const groupScores = [...bestByPublisherGroup.values()];
  const average =
    groupScores.reduce((total, score) => total + score, 0) /
    groupScores.length;
  const independentGroupBonus = Math.min(
    0.16,
    (groupScores.length - 1) * 0.08,
  );
  return clampSignal(average + independentGroupBonus);
}

function titleTokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 0),
  );
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / (left.size + right.size - intersection);
}

function characterBigrams(value: string): Set<string> {
  const compact = normalizeText(value).replace(/\s/g, "");
  if (compact.length < 2) {
    return new Set(compact ? [compact] : []);
  }
  return new Set(
    Array.from({ length: compact.length - 1 }, (_, index) =>
      compact.slice(index, index + 2),
    ),
  );
}

function diceSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((token) => right.has(token)).length;
  return (2 * intersection) / (left.size + right.size);
}

function titleSimilarity(left: string, right: string): number {
  return Math.max(
    jaccardSimilarity(titleTokens(left), titleTokens(right)),
    diceSimilarity(characterBigrams(left), characterBigrams(right)),
  );
}

function assertPreviousInputs(
  titles: readonly string[],
  fingerprints: readonly string[],
): void {
  for (const [index, title] of titles.entries()) {
    if (
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 500
    ) {
      throw new TypeError(
        `과거 게시물 제목 ${index + 1}이 유효하지 않습니다.`,
      );
    }
  }
  for (const [index, fingerprint] of fingerprints.entries()) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new TypeError(
        `과거 콘텐츠 지문 ${index + 1}이 유효하지 않습니다.`,
      );
    }
  }
}

function deriveNovelty(
  articles: readonly NormalizedArticle[],
  previousPostTitles: readonly string[],
  previousContentFingerprints: readonly string[],
): number {
  assertPreviousInputs(previousPostTitles, previousContentFingerprints);

  const previousFingerprints = new Set(previousContentFingerprints);
  if (
    articles.some((article) =>
      previousFingerprints.has(article.contentFingerprint),
    )
  ) {
    return 0;
  }
  if (previousPostTitles.length === 0) {
    return 1;
  }

  const maximumSimilarity = Math.max(
    ...articles.flatMap((article) =>
      previousPostTitles.map((title) =>
        titleSimilarity(article.normalizedTitle, title),
      ),
    ),
  );

  if (maximumSimilarity >= 0.95) return 0;
  if (maximumSimilarity >= 0.8) return 0.1;
  if (maximumSimilarity >= 0.65) return 0.25;
  if (maximumSimilarity >= 0.45) return 0.55;
  if (maximumSimilarity >= 0.25) return 0.8;
  return 1;
}

/**
 * Produces deterministic v1 signals without calling an LLM or backend module.
 * Invalid article/source metadata throws before any score is returned.
 */
export function deriveTopicSignals(
  input: Readonly<DeriveTopicSignalsInput>,
): TopicSignals {
  const articleSources = validateArticleSources(
    input.articles,
    input.sourceRegistryEntries,
  );
  const articles = articleSources.map(({ article }) => article);

  return {
    ...deriveKeywordSignals(articles),
    reliability: deriveReliability(articleSources),
    novelty: deriveNovelty(
      articles,
      input.previousPostTitles ?? [],
      input.previousContentFingerprints ?? [],
    ),
  };
}
