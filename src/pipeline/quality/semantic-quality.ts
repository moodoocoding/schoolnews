import {
  evidenceItemSchema,
  generatedPostSchema,
  qualityResultSchema,
  semanticReviewSchema,
  type EvidenceItem,
  type GeneratedPost,
  type QualityResult,
  type SemanticFinding,
  type SemanticReview,
} from "../../contracts";

export const SEMANTIC_QUALITY_VERSION = "semantic-quality-v1";

type BlockingReason = QualityResult["blockingReasons"][number];
type QualityCheck = QualityResult["checks"][number];

export interface SemanticQualityGateInput {
  post: GeneratedPost;
  evidenceItems: readonly EvidenceItem[];
  /**
   * Optional output from a separately configured semantic evaluator. It is
   * deliberately unknown at this boundary and cannot override deterministic
   * findings.
   */
  evaluatorReview?: unknown;
}

export interface SemanticQualityGateResult {
  semanticReview: SemanticReview;
  qualityResult: QualityResult;
}

interface TextSurface {
  label: string;
  text: string;
  claimIds: string[];
}

interface NumericToken {
  value: string;
  unit: string;
}

const PROMOTIONAL_PATTERNS: readonly {
  label: string;
  pattern: RegExp;
}[] = [
  {
    label: "최고·최상",
    pattern: /(?:세계\s*)?(?:최고|최상)(?:의|급| 수준)?(?![가-힣])/u,
  },
  { label: "완벽", pattern: /완벽(?:한|하게|히|하다|합니다)?(?![가-힣])/u },
  { label: "획기적", pattern: /획기적(?:인|으로)?(?![가-힣])/u },
  { label: "혁명적", pattern: /혁명적(?:인|으로)?(?![가-힣])/u },
  { label: "게임 체인저", pattern: /게임\s*체인저/iu },
  { label: "기적", pattern: /기적(?:의|적(?:인)?)?(?![가-힣])/u },
  { label: "압도적", pattern: /압도적(?:인|으로)?(?![가-힣])/u },
  { label: "무조건", pattern: /무조건(?![가-힣])/u },
  {
    label: "절대 보장",
    pattern: /(?:100\s*%|절대)\s*(?:성공|효과|안전|향상|개선)(?:을|를|이|가)?\s*(?:보장|확신)/u,
  },
  { label: "과도한 느낌표", pattern: /!{2,}/u },
] as const;

// These patterns intentionally require an outcome or a forecast predicate.
// Neutral descriptions such as "확인할 수 있다" are not treated as causal.
const CAUSAL_OR_FORECAST_PATTERNS: readonly RegExp[] = [
  /(?:때문|덕분|도입으로|사용으로|활용으로).{0,40}(?:향상|개선|증진|증가|감소|줄어|낮아|높아|해결|성공|효과)/u,
  /(?:성적|학습|집중|참여|효율|효과|안전성).{0,30}(?:향상|개선|증가|감소|높아|낮아|좋아|나아)/u,
  /(?:향상|개선|증진|해결|증가|감소|줄어들|늘어날|높아질|낮아질).{0,24}(?:했다|됐다|되었다|한다|된다|될\s*것|할\s*것|예상|전망|기대)/u,
  /도움이\s*(?:된다|됐다|될\s*것|될\s*것으로|될\s*수\s*있)/u,
  /(?:효과|성과)(?:가|를)\s*.{0,20}(?:있다|냈다|보였다|높였다|개선했다)/u,
  /(?:예상|전망|기대)(?:된다|한다|하고\s*있다|할\s*수\s*있다)/u,
] as const;

const NUMERIC_TOKEN_PATTERN =
  /\d+(?:,\d{3})*(?:\.\d+)?\s*(?:퍼센트|억원|만원|개월|학년|단계|시간|년|월|일|시|분|초|명|개|곳|건|회|배|%|원|주|대|차)?/gu;

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function check(
  type: string,
  passed: boolean,
  reasons: readonly string[] = [],
): QualityCheck {
  return {
    type,
    passed,
    reasons: reasons.map((reason) => reason.slice(0, 500)),
    checkerVersion: SEMANTIC_QUALITY_VERSION,
  };
}

function findingKey(finding: SemanticFinding): string {
  return [
    finding.code,
    finding.message,
    [...finding.claimIds].sort().join(","),
    [...finding.evidenceIds].sort().join(","),
  ].join("|");
}

function uniqueFindings(findings: readonly SemanticFinding[]): SemanticFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = findingKey(finding);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectTextSurfaces(post: GeneratedPost): TextSurface[] {
  return [
    { label: "제목", text: post.title, claimIds: [] },
    {
      label: "한 줄 요약",
      text: post.oneLineSummary.text,
      claimIds: [...post.oneLineSummary.claimIds],
    },
    ...post.body.flatMap((paragraph, paragraphIndex) =>
      paragraph.sentences.map((sentence, sentenceIndex) => ({
        label: `본문 ${paragraphIndex + 1}-${sentenceIndex + 1}`,
        text: sentence.text,
        claimIds: [...sentence.claimIds],
      })),
    ),
    ...post.questions.map((question, index) => ({
      label: `질문 ${index + 1}`,
      text: question,
      claimIds: [],
    })),
    ...post.claims.map((claim) => ({
      label: `주장 ${claim.claimId}`,
      text: claim.text,
      claimIds: [claim.claimId],
    })),
  ];
}

function evidenceIdsForClaims(
  post: GeneratedPost,
  claimIds: readonly string[],
): string[] {
  const requestedClaimIds = new Set(claimIds);
  return unique(
    post.claims
      .filter((claim) => requestedClaimIds.has(claim.claimId))
      .flatMap((claim) =>
        claim.evidenceRefs.map((reference) => reference.evidenceId),
      ),
  );
}

function findPromotionalLanguage(
  post: GeneratedPost,
  surfaces: readonly TextSurface[],
): SemanticFinding[] {
  const findings: SemanticFinding[] = [];

  for (const surface of surfaces) {
    const matchedLabels = PROMOTIONAL_PATTERNS.filter(({ pattern }) =>
      pattern.test(surface.text),
    ).map(({ label }) => label);

    if (matchedLabels.length === 0) {
      continue;
    }

    findings.push({
      code: "PROMOTIONAL_LANGUAGE",
      message: `${surface.label}에 홍보·과장 가능성이 높은 표현이 있습니다: ${unique(matchedLabels).join(", ")}`,
      claimIds: unique(surface.claimIds),
      evidenceIds: evidenceIdsForClaims(post, surface.claimIds),
    });
  }

  return findings;
}

function hasCausalOrForecastLanguage(text: string): boolean {
  if (/\?\s*$/u.test(text.trim())) {
    return false;
  }
  return CAUSAL_OR_FORECAST_PATTERNS.some((pattern) => pattern.test(text));
}

function findSingleSourceCausalOverreach(
  post: GeneratedPost,
  surfaces: readonly TextSurface[],
  evidenceCatalog: ReadonlyMap<string, EvidenceItem>,
): SemanticFinding[] {
  const findings: SemanticFinding[] = [];

  for (const surface of surfaces) {
    if (!hasCausalOrForecastLanguage(surface.text)) {
      continue;
    }

    // A causal title or question has no claim-level evidence edge, so using all
    // post evidence would let unrelated sources manufacture independence.
    if (surface.claimIds.length === 0) {
      findings.push({
        code: "CAUSAL_OVERREACH",
        message: `${surface.label}의 효과·인과·전망 표현은 명시적인 claim-evidence 연결이 없어 확정할 수 없습니다.`,
        claimIds: [],
        evidenceIds: [],
      });
      continue;
    }

    // Check every claim independently. Combining evidence across unrelated
    // claims in one sentence must not dilute a single-source causal assertion.
    for (const claimId of unique(surface.claimIds)) {
      const evidenceIds = evidenceIdsForClaims(post, [claimId]);
      const evidence = evidenceIds.flatMap((evidenceId) => {
        const item = evidenceCatalog.get(evidenceId);
        return item ? [item] : [];
      });
      const publisherGroups = new Set(
        evidence.map((item) => item.publisherGroupId),
      );
      const provenanceGroups = new Set(
        evidence.map((item) => item.provenanceGroupKey),
      );

      if (publisherGroups.size >= 2 && provenanceGroups.size >= 2) {
        continue;
      }

      const hasUnverifiedRssSummary = evidence.some(
        (item) => item.authority === "none" && item.locator === "RSS 요약",
      );
      const hasUnverifiedSearchSummary = evidence.some(
        (item) =>
          item.authority === "none" &&
          item.locator === "뉴스 검색 API 요약",
      );
      const sourceDescription = hasUnverifiedRssSummary
        ? "직접 사실 권한이 없는 RSS 요약을 포함한 단일 계열 근거"
        : hasUnverifiedSearchSummary
          ? "직접 사실 권한이 없는 뉴스 검색 API 요약을 포함한 단일 계열 근거"
          : "독립적인 publisher·provenance 그룹이 부족한 근거";

      findings.push({
        code: "CAUSAL_OVERREACH",
        message: `${surface.label}의 주장 ${claimId} 효과·인과·전망 표현은 ${sourceDescription}만으로 확정할 수 없습니다.`,
        claimIds: [claimId],
        evidenceIds: unique(evidenceIds),
      });
    }
  }

  return findings;
}

function normalizeNumericToken(rawToken: string): NumericToken {
  const compact = rawToken.normalize("NFKC").replace(/\s+/gu, "");
  const match = compact.match(
    /^(?<number>\d+(?:,\d{3})*(?:\.\d+)?)(?<unit>.*)$/u,
  );
  const rawNumber = match?.groups?.number ?? compact;
  const numericValue = Number(rawNumber.replace(/,/gu, ""));
  const rawUnit = match?.groups?.unit ?? "";
  const unit = rawUnit === "퍼센트" ? "%" : rawUnit;

  return {
    value: Number.isFinite(numericValue) ? String(numericValue) : rawNumber,
    unit,
  };
}

function numericTokens(text: string): NumericToken[] {
  return unique(
    Array.from(text.normalize("NFKC").matchAll(NUMERIC_TOKEN_PATTERN), (match) =>
      JSON.stringify(normalizeNumericToken(match[0])),
    ),
  ).map((token) => JSON.parse(token) as NumericToken);
}

function numericTokenIsSupported(
  claimToken: NumericToken,
  evidenceTokens: readonly NumericToken[],
): boolean {
  return evidenceTokens.some(
    (evidenceToken) =>
      evidenceToken.value === claimToken.value &&
      (claimToken.unit === "" || evidenceToken.unit === claimToken.unit),
  );
}

function displayNumericToken(token: NumericToken): string {
  return `${token.value}${token.unit}`;
}

function findUnsupportedNumericClaims(
  post: GeneratedPost,
  evidenceCatalog: ReadonlyMap<string, EvidenceItem>,
): SemanticFinding[] {
  const findings: SemanticFinding[] = [];

  for (const claim of post.claims) {
    const claimTokens = numericTokens(claim.text);
    if (claimTokens.length === 0) {
      continue;
    }

    const evidenceIds = unique(
      claim.evidenceRefs.map((reference) => reference.evidenceId),
    );
    const evidenceTokens = evidenceIds.flatMap((evidenceId) =>
      numericTokens(evidenceCatalog.get(evidenceId)?.passage ?? ""),
    );
    const unsupportedTokens = claimTokens.filter(
      (claimToken) => !numericTokenIsSupported(claimToken, evidenceTokens),
    );

    if (unsupportedTokens.length === 0) {
      continue;
    }

    findings.push({
      code: "UNSUPPORTED_CLAIM",
      message: `주장 ${claim.claimId}의 수치·날짜가 연결된 근거 passage에서 확인되지 않습니다: ${unsupportedTokens.map(displayNumericToken).join(", ")}`,
      claimIds: [claim.claimId],
      evidenceIds,
    });
  }

  return findings;
}

function findUnsupportedPublicNumericText(
  post: GeneratedPost,
  surfaces: readonly TextSurface[],
  evidenceCatalog: ReadonlyMap<string, EvidenceItem>,
): SemanticFinding[] {
  const findings: SemanticFinding[] = [];

  for (const surface of surfaces.filter(
    (candidate) => !candidate.label.startsWith("주장 "),
  )) {
    const surfaceTokens = numericTokens(surface.text);
    if (surfaceTokens.length === 0) {
      continue;
    }
    const evidenceIds = evidenceIdsForClaims(post, surface.claimIds);
    const evidenceTokens = evidenceIds.flatMap((evidenceId) =>
      numericTokens(evidenceCatalog.get(evidenceId)?.passage ?? ""),
    );
    const unsupportedTokens = surfaceTokens.filter(
      (token) => !numericTokenIsSupported(token, evidenceTokens),
    );
    if (unsupportedTokens.length === 0) {
      continue;
    }

    findings.push({
      code: "UNSUPPORTED_CLAIM",
      message: `${surface.label}의 수치·날짜가 연결된 근거 passage에서 확인되지 않습니다: ${unsupportedTokens.map(displayNumericToken).join(", ")}`,
      claimIds: unique(surface.claimIds),
      evidenceIds: unique(evidenceIds),
    });
  }

  return findings;
}

function validateEvaluatorReview(
  candidate: unknown,
  post: GeneratedPost,
  evidenceCatalog: ReadonlyMap<string, EvidenceItem>,
): { findings: SemanticFinding[]; check: QualityCheck } {
  if (candidate === undefined) {
    return {
      findings: [],
      check: check("external_semantic_review", true),
    };
  }

  const parsed = semanticReviewSchema.safeParse(candidate);
  if (!parsed.success) {
    const finding: SemanticFinding = {
      code: "SOURCE_CONFLICT",
      message: "외부 의미 검사 결과가 SemanticReview 계약을 통과하지 못했습니다.",
      claimIds: [],
      evidenceIds: [],
    };
    return {
      findings: [finding],
      check: check("external_semantic_review", false, [finding.message]),
    };
  }

  const postClaimIds = new Set(post.claims.map((claim) => claim.claimId));
  const postEvidenceIds = new Set(post.usedEvidenceIds);
  const invalidReference = parsed.data.findings.some(
    (finding) =>
      finding.claimIds.some((claimId) => !postClaimIds.has(claimId)) ||
      finding.evidenceIds.some(
        (evidenceId) =>
          !postEvidenceIds.has(evidenceId) || !evidenceCatalog.has(evidenceId),
      ),
  );

  if (invalidReference) {
    const finding: SemanticFinding = {
      code: "SOURCE_CONFLICT",
      message:
        "외부 의미 검사 결과가 현재 게시물에 없는 주장 또는 근거 ID를 참조했습니다.",
      claimIds: [],
      evidenceIds: [],
    };
    return {
      findings: [finding],
      check: check("external_semantic_review", false, [finding.message]),
    };
  }

  return {
    findings: parsed.data.findings,
    check: check(
      "external_semantic_review",
      parsed.data.passed,
      parsed.data.findings.map((finding) => finding.message),
    ),
  };
}

function invalidInputResult(message: string): SemanticQualityGateResult {
  const finding = semanticReviewSchema.parse({
    passed: false,
    evaluatorVersion: SEMANTIC_QUALITY_VERSION,
    findings: [
      {
        code: "SOURCE_CONFLICT",
        message,
        claimIds: [],
        evidenceIds: [],
      },
    ],
  });
  const qualityResult = qualityResultSchema.parse({
    passed: false,
    checks: [check("semantic_gate_input", false, [message])],
    blockingReasons: ["SOURCE_CONFLICT"],
  });

  return { semanticReview: finding, qualityResult };
}

/**
 * Applies conservative, deterministic semantic checks and optionally merges a
 * separately produced evaluator review. Every malformed or stale evaluator
 * result is publication-blocking.
 */
export function runSemanticQualityGate(
  input: Readonly<SemanticQualityGateInput>,
): SemanticQualityGateResult {
  const parsedPost = generatedPostSchema.safeParse(input.post);
  if (!parsedPost.success) {
    return invalidInputResult(
      "의미 품질 검사의 게시물 입력이 GeneratedPost 계약을 통과하지 못했습니다.",
    );
  }

  const parsedEvidence: EvidenceItem[] = [];
  for (const candidate of input.evidenceItems) {
    const parsed = evidenceItemSchema.safeParse(candidate);
    if (!parsed.success) {
      return invalidInputResult(
        "의미 품질 검사의 근거 입력이 EvidenceItem 계약을 통과하지 못했습니다.",
      );
    }
    parsedEvidence.push(parsed.data);
  }

  const duplicateEvidenceIds = parsedEvidence
    .map((item) => item.evidenceId)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateEvidenceIds.length > 0) {
    return invalidInputResult(
      "의미 품질 검사 근거 목록에 중복된 EvidenceItem ID가 있습니다.",
    );
  }

  const post = parsedPost.data;
  const evidenceCatalog = new Map(
    parsedEvidence.map((item) => [item.evidenceId, item]),
  );
  if (post.usedEvidenceIds.some((evidenceId) => !evidenceCatalog.has(evidenceId))) {
    return invalidInputResult(
      "의미 품질 검사 게시물이 근거 목록에 없는 EvidenceItem ID를 참조했습니다.",
    );
  }
  const surfaces = collectTextSurfaces(post);
  const promotionalFindings = findPromotionalLanguage(post, surfaces);
  const causalFindings = findSingleSourceCausalOverreach(
    post,
    surfaces,
    evidenceCatalog,
  );
  const numericFindings = findUnsupportedNumericClaims(post, evidenceCatalog);
  const publicNumericFindings = findUnsupportedPublicNumericText(
    post,
    surfaces,
    evidenceCatalog,
  );
  const evaluator = validateEvaluatorReview(
    input.evaluatorReview,
    post,
    evidenceCatalog,
  );
  const findings = uniqueFindings([
    ...promotionalFindings,
    ...causalFindings,
    ...numericFindings,
    ...publicNumericFindings,
    ...evaluator.findings,
  ]);

  const semanticReview = semanticReviewSchema.parse({
    passed: findings.length === 0,
    evaluatorVersion: SEMANTIC_QUALITY_VERSION,
    findings,
  });
  const checks = [
    check(
      "promotional_language",
      promotionalFindings.length === 0,
      promotionalFindings.map((finding) => finding.message),
    ),
    check(
      "single_source_causality",
      causalFindings.length === 0,
      causalFindings.map((finding) => finding.message),
    ),
    check(
      "numeric_evidence_support",
      numericFindings.length === 0 && publicNumericFindings.length === 0,
      [...numericFindings, ...publicNumericFindings].map(
        (finding) => finding.message,
      ),
    ),
    evaluator.check,
  ];
  const blockingReasons = unique(
    findings.map((finding) => finding.code as BlockingReason),
  );
  const qualityResult = qualityResultSchema.parse({
    passed: checks.every((item) => item.passed),
    checks,
    blockingReasons,
  });

  return { semanticReview, qualityResult };
}

/** Combines independent quality gates without allowing a failed gate to pass. */
export function mergeQualityResults(
  first: QualityResult,
  ...rest: readonly QualityResult[]
): QualityResult {
  const candidates = [first, ...rest];
  const checks: QualityCheck[] = [];
  const blockingReasons: BlockingReason[] = [];

  for (const candidate of candidates) {
    const parsed = qualityResultSchema.safeParse(candidate);
    if (!parsed.success) {
      checks.push(
        check("quality_result_merge_input", false, [
          "병합할 품질 결과가 QualityResult 계약을 통과하지 못했습니다.",
        ]),
      );
      blockingReasons.push("SOURCE_CONFLICT");
      continue;
    }

    checks.push(...parsed.data.checks);
    blockingReasons.push(...parsed.data.blockingReasons);
  }

  return qualityResultSchema.parse({
    passed: checks.every((item) => item.passed),
    checks,
    blockingReasons: unique(blockingReasons),
  });
}
