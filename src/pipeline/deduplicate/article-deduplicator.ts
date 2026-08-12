import {
  normalizedArticleSchema,
  type NormalizedArticle,
} from "../../contracts";

function compareArticles(
  left: NormalizedArticle,
  right: NormalizedArticle,
): number {
  const publicationOrder =
    Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  if (publicationOrder !== 0) {
    return publicationOrder;
  }

  const discoveryOrder =
    Date.parse(left.discoveredAt) - Date.parse(right.discoveredAt);
  if (discoveryOrder !== 0) {
    return discoveryOrder;
  }

  return left.articleId.localeCompare(right.articleId, "en");
}

/**
 * Keeps one deterministic representative for each canonical URL or content
 * fingerprint, independent of caller input order.
 */
export function deduplicateArticles(
  inputs: readonly NormalizedArticle[],
): NormalizedArticle[] {
  const articles = inputs.map((input) => normalizedArticleSchema.parse(input));
  const parents = articles.map((_, index) => index);

  function find(index: number): number {
    let root = index;
    while (parents[root] !== root) {
      root = parents[root];
    }
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  }

  function union(left: number, right: number): void {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    }
  }

  const firstIndexByCanonicalHash = new Map<string, number>();
  const firstIndexByFingerprint = new Map<string, number>();
  for (const [index, article] of articles.entries()) {
    const canonicalMatch = firstIndexByCanonicalHash.get(article.canonicalUrlHash);
    if (canonicalMatch === undefined) {
      firstIndexByCanonicalHash.set(article.canonicalUrlHash, index);
    } else {
      union(index, canonicalMatch);
    }

    const fingerprintMatch = firstIndexByFingerprint.get(article.contentFingerprint);
    if (fingerprintMatch === undefined) {
      firstIndexByFingerprint.set(article.contentFingerprint, index);
    } else {
      union(index, fingerprintMatch);
    }
  }

  const groups = new Map<number, NormalizedArticle[]>();
  for (const [index, article] of articles.entries()) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(article);
    groups.set(root, group);
  }

  return Array.from(groups.values())
    .map((group) => group.sort(compareArticles)[0])
    .sort(compareArticles);
}
