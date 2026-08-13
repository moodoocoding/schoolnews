import { createHash } from "node:crypto";

import type { ArticleModelDocument, EvidenceItem } from "../contracts";

export const MAX_MODEL_EVIDENCE_ITEMS = 12;
export const MAX_MODEL_EVIDENCE_GRAPHEMES = 6_000;
export const MAX_MODEL_ARTICLE_DOCUMENTS = 4;
export const MAX_MODEL_ARTICLE_DOCUMENT_GRAPHEMES = 18_000;
export const MAX_MODEL_ARTICLE_TOTAL_GRAPHEMES = 32_000;
export const MAX_MODEL_PROMPT_ESTIMATED_TOKENS = 36_000;

const sensitivePatterns = [
  /\b\d{6}\s*[- ]?\s*[1-8]\d{6}\b/u,
  /(?:학생\s*이름|아동\s*이름|보호자\s*이름)\s*[:：]\s*[가-힣]{2,5}/u,
  /[가-힣]{2,5}\s*학생\s*\(?\s*\d{1,2}\s*학년\s*\d{1,2}\s*반/u,
  /[가-힣]{0,20}(?:초등학교|초교|초)\s+\d{1,2}\s*학년\s+[가-힣]{2,5}\s*(?:학생|군|양|어린이)/u,
  /[가-힣]{2,5}\s*\(\s*\d{1,2}\s*[·,]\s*[가-힣]{1,20}(?:초등학교|초교|초)\s*\)/u,
  /(?:학교명|재학학교|주소|거주지)\s*[:：]\s*[^\n,]{2,80}/u,
  /\d{1,2}\s*학년\s*\d{1,2}\s*반\s*\d{1,3}\s*번/u,
  /(?:카카오톡|텔레그램|인스타그램|SNS)\s*(?:ID|아이디|계정)?\s*[:：]\s*@?[A-Za-z0-9._-]{3,}/iu,
];

export function modelInputGraphemeCount(value: string): number {
  return Array.from(value.normalize("NFC")).length;
}

/**
 * Conservative tokenizer-independent ceiling. Korean may approach one token
 * per grapheme, so no provider request is allowed to assume a lower count.
 */
export function estimateModelInputTokens(value: string): number {
  return modelInputGraphemeCount(value);
}

function assertNoSensitiveIdentity(value: string): void {
  if (sensitivePatterns.some((pattern) => pattern.test(value))) {
    throw new TypeError("모델 입력에서 학생·보호자 식별 가능 정보를 감지했습니다.");
  }
}

export function assertEvidenceSafeForModel(
  items: readonly EvidenceItem[],
): void {
  if (items.length > MAX_MODEL_EVIDENCE_ITEMS) {
    throw new TypeError("모델 입력 근거 개수 한도를 초과했습니다.");
  }

  let total = 0;
  for (const item of items) {
    const values = [
      item.sourceName,
      item.title,
      item.passage,
      item.locator ?? "",
    ];
    for (const value of values) {
      total += modelInputGraphemeCount(value);
      assertNoSensitiveIdentity(value);
    }
  }

  if (total > MAX_MODEL_EVIDENCE_GRAPHEMES) {
    throw new TypeError("모델 입력 근거 전체 길이 한도를 초과했습니다.");
  }
}

export function assertArticleDocumentsSafeForModel(
  documents: readonly ArticleModelDocument[],
  evidenceItems: readonly EvidenceItem[],
): void {
  if (documents.length === 0) {
    throw new TypeError("허용된 기사 문서가 없어 모델을 호출할 수 없습니다.");
  }
  if (documents.length > MAX_MODEL_ARTICLE_DOCUMENTS) {
    throw new TypeError("모델 입력 기사 문서 개수 한도를 초과했습니다.");
  }

  const evidenceById = new Map(
    evidenceItems.map((item) => [item.evidenceId, item]),
  );
  const seenDocumentIds = new Set<string>();
  const seenEvidenceIds = new Set<string>();
  let total = 0;
  const now = Date.now();

  for (const document of documents) {
    const evidence = evidenceById.get(document.evidenceId);
    if (
      seenDocumentIds.has(document.documentId) ||
      seenEvidenceIds.has(document.evidenceId) ||
      evidence === undefined ||
      document.articleId !== evidence.articleId ||
      document.sourceId !== evidence.sourceId ||
      document.sourceName !== evidence.sourceName ||
      document.title !== evidence.title ||
      document.publishedAt !== evidence.publishedAt
    ) {
      throw new TypeError("기사 문서와 생성 근거의 출처 계보가 일치하지 않습니다.");
    }
    if (Date.parse(document.retentionExpiresAt) <= now) {
      throw new TypeError("보존 기한이 지난 기사 문서는 모델에 전송할 수 없습니다.");
    }
    if (
      createHash("sha256").update(document.contentText).digest("hex") !==
      document.contentHash
    ) {
      throw new TypeError("기사 문서 해시가 본문과 일치하지 않습니다.");
    }

    const documentLength = modelInputGraphemeCount(document.contentText);
    if (documentLength > MAX_MODEL_ARTICLE_DOCUMENT_GRAPHEMES) {
      throw new TypeError(
        "기사 원문을 잘라내지 않고 모델 입력 단일 문서 한도 초과로 차단했습니다.",
      );
    }
    total += documentLength;
    assertNoSensitiveIdentity(document.sourceName);
    assertNoSensitiveIdentity(document.title);
    assertNoSensitiveIdentity(document.contentText);
    seenDocumentIds.add(document.documentId);
    seenEvidenceIds.add(document.evidenceId);
  }

  if (evidenceItems.some((item) => !seenEvidenceIds.has(item.evidenceId))) {
    throw new TypeError("선정된 근거 중 기사 원문이 없는 항목이 있습니다.");
  }
  if (total > MAX_MODEL_ARTICLE_TOTAL_GRAPHEMES) {
    throw new TypeError(
      "기사 원문을 잘라내지 않고 모델 입력 전체 길이 한도 초과로 차단했습니다.",
    );
  }
}

export function assertPromptWithinModelTokenLimit(prompt: string): void {
  if (estimateModelInputTokens(prompt) > MAX_MODEL_PROMPT_ESTIMATED_TOKENS) {
    throw new TypeError("모델 전체 프롬프트 토큰 추정 한도를 초과했습니다.");
  }
}
