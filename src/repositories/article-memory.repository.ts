import {
  normalizedArticleSchema,
  type NormalizedArticle,
} from "../contracts";

export interface ArticleUpsertResult {
  insertedCount: number;
  duplicateCount: number;
  totalCount: number;
}

/** In-memory M2 adapter. Firestore can implement the same small interface later. */
export class MemoryArticleRepository {
  readonly #articlesById = new Map<string, NormalizedArticle>();
  readonly #articleIdByCanonicalHash = new Map<string, string>();
  readonly #articleIdByFingerprint = new Map<string, string>();

  async upsertMany(
    inputs: readonly NormalizedArticle[],
  ): Promise<ArticleUpsertResult> {
    // Parse the full batch first so invalid input cannot cause a partial write.
    const articles = inputs.map((input) => normalizedArticleSchema.parse(input));
    let insertedCount = 0;
    let duplicateCount = 0;

    for (const article of articles) {
      const duplicateId =
        this.#articlesById.has(article.articleId)
          ? article.articleId
          : this.#articleIdByCanonicalHash.get(article.canonicalUrlHash) ??
            this.#articleIdByFingerprint.get(article.contentFingerprint);

      if (duplicateId !== undefined) {
        duplicateCount += 1;
        continue;
      }

      const stored = structuredClone(article);
      this.#articlesById.set(stored.articleId, stored);
      this.#articleIdByCanonicalHash.set(stored.canonicalUrlHash, stored.articleId);
      this.#articleIdByFingerprint.set(stored.contentFingerprint, stored.articleId);
      insertedCount += 1;
    }

    return {
      insertedCount,
      duplicateCount,
      totalCount: this.#articlesById.size,
    };
  }

  async findById(articleId: string): Promise<NormalizedArticle | null> {
    const article = this.#articlesById.get(articleId);
    return article === undefined ? null : structuredClone(article);
  }

  async listAll(): Promise<NormalizedArticle[]> {
    return Array.from(this.#articlesById.values(), (article) =>
      structuredClone(article),
    ).sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
        left.articleId.localeCompare(right.articleId, "en"),
    );
  }

  async count(): Promise<number> {
    return this.#articlesById.size;
  }
}
