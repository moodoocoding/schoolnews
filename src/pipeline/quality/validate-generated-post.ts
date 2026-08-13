import type { ZodIssue } from "zod";

import {
  evidenceItemSchema,
  generatedPostSchema,
  graphemeLength,
  qualityResultSchema,
  type EvidenceItem,
  type GeneratedPost,
  type QualityResult,
  type TopicCandidate,
} from "../../contracts";

export const GENERATED_POST_QUALITY_VERSION = "generated-post-quality-v2";

const CONTENT_LIMITS = {
  title: 36,
  oneLineSummary: 100,
  body: 1_000,
  minimumBody: 600,
  question: 80,
  minimumParagraphs: 3,
  maximumParagraphs: 5,
  minimumQuestions: 1,
  maximumQuestions: 2,
} as const;

type EvidencePolicy = TopicCandidate["evidencePolicy"];
type BlockingReason = QualityResult["blockingReasons"][number];
type QualityCheck = QualityResult["checks"][number];

export interface GeneratedPostValidationInput {
  post: unknown;
  evidenceItems: readonly EvidenceItem[];
  evidencePolicy: EvidencePolicy;
  /**
   * Defaults to false. The retrieval layer must explicitly attest that the
   * source contains a narrow, authoritative fact before the exception is used.
   */
  allowAuthoritativeSingleSource?: boolean;
}

function check(
  type: string,
  passed: boolean,
  reasons: string[] = [],
): QualityCheck {
  return {
    type,
    passed,
    reasons: reasons.map((reason) => reason.slice(0, 500)),
    checkerVersion: GENERATED_POST_QUALITY_VERSION,
  };
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function isLengthIssue(issue: ZodIssue): boolean {
  return issue.code === "too_big" || issue.message.includes("최대");
}

function isMissingEvidenceIssue(issue: ZodIssue): boolean {
  return issue.path.includes("evidenceRefs");
}

function finish(
  checks: QualityCheck[],
  blockingReasons: readonly BlockingReason[],
): QualityResult {
  return qualityResultSchema.parse({
    passed: checks.every((item) => item.passed),
    checks,
    blockingReasons: unique(blockingReasons),
  });
}

function validateEvidenceCatalog(evidenceItems: readonly EvidenceItem[]): {
  check: QualityCheck;
  items: EvidenceItem[];
} {
  const items: EvidenceItem[] = [];
  const reasons: string[] = [];

  evidenceItems.forEach((candidate, index) => {
    const parsed = evidenceItemSchema.safeParse(candidate);
    if (!parsed.success) {
      reasons.push(`EvidenceItem ${index + 1}의 메타데이터가 유효하지 않습니다.`);
      return;
    }
    items.push(parsed.data);
  });

  const duplicateIds = unique(
    items
      .map((item) => item.evidenceId)
      .filter((id, index, allIds) => allIds.indexOf(id) !== index),
  );
  if (duplicateIds.length > 0) {
    reasons.push(`중복 EvidenceItem ID: ${duplicateIds.join(", ")}`);
  }

  return {
    check: check("source_metadata", reasons.length === 0, reasons),
    items,
  };
}

function checkEvidenceLinks(
  post: GeneratedPost,
  catalog: ReadonlyMap<string, EvidenceItem>,
): { check: QualityCheck; blockingReasons: BlockingReason[] } {
  const reasons: string[] = [];
  const blockingReasons: BlockingReason[] = [];
  const claimEvidenceIds = post.claims.flatMap((claim) =>
    claim.evidenceRefs.map((reference) => reference.evidenceId),
  );
  const missingEvidenceIds = unique(
    [...claimEvidenceIds, ...post.usedEvidenceIds].filter(
      (evidenceId) => !catalog.has(evidenceId),
    ),
  );

  if (missingEvidenceIds.length > 0) {
    reasons.push(`존재하지 않는 EvidenceItem ID: ${missingEvidenceIds.join(", ")}`);
    blockingReasons.push("MISSING_EVIDENCE");
  }

  const publicClaimIds = new Set([
    ...post.oneLineSummary.claimIds,
    ...post.body.flatMap((paragraph) =>
      paragraph.sentences.flatMap((sentence) => sentence.claimIds),
    ),
  ]);
  const unsupportedClaims = post.claims.filter(
    (claim) =>
      (claim.kind === "fact" ||
        claim.kind === "context" ||
        publicClaimIds.has(claim.claimId)) &&
      (claim.evidenceRefs.length === 0 ||
        claim.evidenceRefs.every((reference) => !catalog.has(reference.evidenceId))),
  );
  if (unsupportedClaims.length > 0) {
    reasons.push(
      `근거와 연결되지 않은 사실·맥락 또는 공개 문장 주장: ${unsupportedClaims
        .map((claim) => claim.claimId)
        .join(", ")}`,
    );
    blockingReasons.push("UNSUPPORTED_CLAIM");
  }

  const claimedSet = new Set(claimEvidenceIds);
  const usedSet = new Set(post.usedEvidenceIds);
  const mismatchedIds = unique([
    ...claimEvidenceIds.filter((id) => !usedSet.has(id)),
    ...post.usedEvidenceIds.filter((id) => !claimedSet.has(id)),
  ]);
  if (mismatchedIds.length > 0) {
    reasons.push(`usedEvidenceIds 불일치: ${mismatchedIds.join(", ")}`);
    blockingReasons.push("FORMAT_INVALID");
  }

  const duplicateUsedEvidenceIds = unique(
    post.usedEvidenceIds.filter(
      (id, index, evidenceIds) => evidenceIds.indexOf(id) !== index,
    ),
  );
  if (duplicateUsedEvidenceIds.length > 0) {
    reasons.push(`usedEvidenceIds 중복: ${duplicateUsedEvidenceIds.join(", ")}`);
    blockingReasons.push("FORMAT_INVALID");
  }

  return {
    check: check("evidence_links", reasons.length === 0, reasons),
    blockingReasons: unique(blockingReasons),
  };
}

function checkKeyClaimCitations(post: GeneratedPost): QualityCheck {
  const missingCitationClaims = post.claims
    .filter((claim) => claim.importance === "key" && !claim.displayCitation)
    .map((claim) => claim.claimId);

  return check(
    "key_claim_citations",
    missingCitationClaims.length === 0,
    missingCitationClaims.length === 0
      ? []
      : [`공개 출처 표시가 없는 핵심 주장: ${missingCitationClaims.join(", ")}`],
  );
}

function checkContentLengths(post: GeneratedPost): QualityCheck {
  const reasons: string[] = [];
  const bodyLength = post.body.reduce(
    (total, paragraph) =>
      total +
      paragraph.sentences.reduce(
        (paragraphTotal, sentence) => paragraphTotal + graphemeLength(sentence.text),
        0,
      ),
    0,
  );

  if (graphemeLength(post.title) > CONTENT_LIMITS.title) {
    reasons.push(`제목은 ${CONTENT_LIMITS.title}자를 넘을 수 없습니다.`);
  }
  if (graphemeLength(post.oneLineSummary.text) > CONTENT_LIMITS.oneLineSummary) {
    reasons.push(`한 줄 요약은 ${CONTENT_LIMITS.oneLineSummary}자를 넘을 수 없습니다.`);
  }
  if (bodyLength > CONTENT_LIMITS.body) {
    reasons.push(`본문은 ${CONTENT_LIMITS.body}자를 넘을 수 없습니다.`);
  }
  if (bodyLength < CONTENT_LIMITS.minimumBody) {
    reasons.push(
      `본문은 최소 ${CONTENT_LIMITS.minimumBody}자 이상의 기사형 내용으로 작성해야 합니다.`,
    );
  }
  if (
    post.body.length < CONTENT_LIMITS.minimumParagraphs ||
    post.body.length > CONTENT_LIMITS.maximumParagraphs
  ) {
    reasons.push("본문은 3~5문단이어야 합니다.");
  }
  if (
    post.questions.length < CONTENT_LIMITS.minimumQuestions ||
    post.questions.length > CONTENT_LIMITS.maximumQuestions
  ) {
    reasons.push("질문은 1~2개여야 합니다.");
  }
  if (
    post.questions.some(
      (question) => graphemeLength(question) > CONTENT_LIMITS.question,
    )
  ) {
    reasons.push(`질문은 각각 ${CONTENT_LIMITS.question}자를 넘을 수 없습니다.`);
  }

  return check("content_length", reasons.length === 0, reasons);
}

function checkSourceIndependence(
  policy: EvidencePolicy,
  post: GeneratedPost,
  usedEvidence: readonly EvidenceItem[],
  allowAuthoritativeSingleSource: boolean,
): QualityCheck {
  const publisherGroups = new Set(
    usedEvidence.map((evidence) => evidence.publisherGroupId),
  );
  const provenanceGroups = new Set(
    usedEvidence.map((evidence) => evidence.provenanceGroupKey),
  );
  const primaryItems = usedEvidence.filter(
    (evidence) => evidence.sourceRole === "primary" && evidence.sourceType === "primary",
  );
  const independentItems = usedEvidence.filter(
    (evidence) => evidence.sourceRole === "independent",
  );

  let passed = false;
  let reason = "";

  if (policy === "primary_plus_independent") {
    passed = primaryItems.some((primary) =>
      independentItems.some(
        (independent) =>
          independent.publisherGroupId !== primary.publisherGroupId &&
          independent.provenanceGroupKey !== primary.provenanceGroupKey,
      ),
    );
    reason = "서로 다른 원출처의 공식 1차 자료와 독립 기관·연구·보도가 필요합니다.";
  } else if (policy === "two_independent_sources") {
    passed = publisherGroups.size >= 2 && provenanceGroups.size >= 2;
    reason = "소유·원출처가 서로 다른 신뢰 출처가 2개 이상 필요합니다.";
  } else {
    const hasOnlyDirectFactClaims = post.claims.every(
      (claim) =>
        claim.kind === "fact" &&
        claim.evidenceRefs.length > 0 &&
        claim.evidenceRefs.every((reference) => reference.support === "direct"),
    );
    passed =
      allowAuthoritativeSingleSource &&
      primaryItems.length > 0 &&
      primaryItems.every(
        (evidence) => evidence.authority === "public_authority_direct_fact",
      ) &&
      publisherGroups.size === 1 &&
      provenanceGroups.size === 1 &&
      hasOnlyDirectFactClaims;
    reason = allowAuthoritativeSingleSource
      ? "단일 출처 예외는 권한 있는 공식 1차 자료의 직접 근거가 연결된 단순 사실 주장에만 적용할 수 있습니다."
      : "단일 출처 예외가 명시적으로 승인되지 않았습니다.";
  }

  return check("source_independence", passed, passed ? [] : [reason]);
}

/**
 * Runs the deterministic, publication-blocking checks that can be completed
 * without another model call. Semantic contradiction and duplication checks
 * are deliberately left for later pipeline stages.
 */
export function validateGeneratedPost(
  input: Readonly<GeneratedPostValidationInput>,
): QualityResult {
  const parsedPost = generatedPostSchema.safeParse(input.post);

  if (!parsedPost.success) {
    const issues = parsedPost.error.issues;
    const blockingReasons: BlockingReason[] = ["FORMAT_INVALID"];

    if (issues.some(isLengthIssue)) {
      blockingReasons.push("CONTENT_TOO_LONG");
    }
    if (issues.some(isMissingEvidenceIssue)) {
      blockingReasons.push("MISSING_EVIDENCE", "UNSUPPORTED_CLAIM");
    }

    return finish(
      [check("generated_post_schema", false, issues.map((issue) => issue.message))],
      blockingReasons,
    );
  }

  const checks: QualityCheck[] = [check("generated_post_schema", true)];
  const blockingReasons: BlockingReason[] = [];
  const evidenceCatalogResult = validateEvidenceCatalog(input.evidenceItems);
  checks.push(evidenceCatalogResult.check);
  if (!evidenceCatalogResult.check.passed) {
    blockingReasons.push("SOURCE_METADATA_INVALID");
  }

  const catalog = new Map(
    evidenceCatalogResult.items.map((item) => [item.evidenceId, item]),
  );
  const evidenceLinkResult = checkEvidenceLinks(parsedPost.data, catalog);
  checks.push(evidenceLinkResult.check);
  blockingReasons.push(...evidenceLinkResult.blockingReasons);

  const citationCheck = checkKeyClaimCitations(parsedPost.data);
  checks.push(citationCheck);
  if (!citationCheck.passed) {
    blockingReasons.push("FORMAT_INVALID");
  }

  const contentLengthCheck = checkContentLengths(parsedPost.data);
  checks.push(contentLengthCheck);
  if (!contentLengthCheck.passed) {
    const bodyLength = parsedPost.data.body.reduce(
      (total, paragraph) =>
        total +
        paragraph.sentences.reduce(
          (paragraphTotal, sentence) =>
            paragraphTotal + graphemeLength(sentence.text),
          0,
        ),
      0,
    );
    blockingReasons.push(
      bodyLength < CONTENT_LIMITS.minimumBody
        ? "CONTENT_TOO_SHORT"
        : "CONTENT_TOO_LONG",
    );
  }

  const usedEvidence = parsedPost.data.usedEvidenceIds.flatMap((evidenceId) => {
    const evidence = catalog.get(evidenceId);
    return evidence ? [evidence] : [];
  });
  const independenceCheck = checkSourceIndependence(
    input.evidencePolicy,
    parsedPost.data,
    usedEvidence,
    input.allowAuthoritativeSingleSource ?? false,
  );
  checks.push(independenceCheck);
  if (!independenceCheck.passed) {
    blockingReasons.push("INSUFFICIENT_INDEPENDENT_SOURCES");
  }

  return finish(checks, blockingReasons);
}
