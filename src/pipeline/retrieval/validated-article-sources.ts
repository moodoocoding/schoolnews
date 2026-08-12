import {
  normalizedArticleSchema,
  sourceRegistryEntrySchema,
  type NormalizedArticle,
  type SourceRegistryEntry,
} from "../../contracts";

export class CandidateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateInputError";
  }
}

export interface ValidatedArticleSource {
  article: NormalizedArticle;
  source: SourceRegistryEntry;
}

function validationIssueSummary(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  return issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

function assertCompatible(
  article: NormalizedArticle,
  source: SourceRegistryEntry,
): void {
  if (article.sourceId !== source.sourceId) {
    throw new CandidateInputError(
      `기사 ${article.articleId}의 sourceId가 레지스트리와 일치하지 않습니다.`,
    );
  }

  if (article.publisherGroupId !== source.publisherGroupId) {
    throw new CandidateInputError(
      `기사 ${article.articleId}의 publisherGroupId가 레지스트리와 일치하지 않습니다.`,
    );
  }

  if (article.originType !== source.originType) {
    throw new CandidateInputError(
      `기사 ${article.articleId}의 originType이 레지스트리와 일치하지 않습니다.`,
    );
  }

  if (!article.provenanceGroupKey.startsWith(source.provenanceGroupPrefix)) {
    throw new CandidateInputError(
      `기사 ${article.articleId}의 provenanceGroupKey가 레지스트리 접두사와 일치하지 않습니다.`,
    );
  }

  if (!source.enabled || source.accessStatus !== "allowed") {
    throw new CandidateInputError(
      `기사 ${article.articleId}의 수집원은 활성화되고 접근 허용된 상태여야 합니다.`,
    );
  }
}

/**
 * Runtime-validates articles and registry metadata, then joins them by sourceId.
 * Ambiguous, missing, inactive, or incompatible metadata blocks the candidate.
 */
export function validateArticleSources(
  articles: readonly NormalizedArticle[],
  sourceRegistryEntries: readonly SourceRegistryEntry[],
): ValidatedArticleSource[] {
  if (articles.length === 0) {
    throw new CandidateInputError("후보 평가에는 기사가 한 건 이상 필요합니다.");
  }

  const sourcesById = new Map<string, SourceRegistryEntry>();

  for (const [index, sourceInput] of sourceRegistryEntries.entries()) {
    const parsed = sourceRegistryEntrySchema.safeParse(sourceInput);
    if (!parsed.success) {
      throw new CandidateInputError(
        `수집원 ${index + 1}의 메타데이터가 유효하지 않습니다: ${validationIssueSummary(parsed.error.issues)}`,
      );
    }
    if (sourcesById.has(parsed.data.sourceId)) {
      throw new CandidateInputError(
        `중복된 수집원 ID가 있습니다: ${parsed.data.sourceId}`,
      );
    }
    sourcesById.set(parsed.data.sourceId, parsed.data);
  }

  return articles.map((articleInput, index) => {
    const parsed = normalizedArticleSchema.safeParse(articleInput);
    if (!parsed.success) {
      throw new CandidateInputError(
        `기사 ${index + 1}의 메타데이터가 유효하지 않습니다: ${validationIssueSummary(parsed.error.issues)}`,
      );
    }

    const source = sourcesById.get(parsed.data.sourceId);
    if (!source) {
      throw new CandidateInputError(
        `기사 ${parsed.data.articleId}에 대응하는 수집원이 없습니다.`,
      );
    }

    assertCompatible(parsed.data, source);
    return { article: parsed.data, source };
  });
}
