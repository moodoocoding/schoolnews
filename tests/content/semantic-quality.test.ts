import { describe, expect, it } from "vitest";

import type { GeneratedPost, QualityResult } from "../../src/contracts";
import {
  mergeQualityResults,
  runSemanticQualityGate,
  validateGeneratedPost,
} from "../../src/pipeline/quality";
import {
  externalSemanticFindingFixture,
  semanticEvidenceFixture,
  semanticPostFixture,
} from "../fixtures/content/semantic";

function run(post = semanticPostFixture()) {
  return runSemanticQualityGate({
    post,
    evidenceItems: semanticEvidenceFixture(),
  });
}

function setPromotionalText(post: GeneratedPost, target: string): void {
  switch (target) {
    case "title":
      post.title = "완벽한 AI 교육의 시작";
      break;
    case "summary":
      post.oneLineSummary.text = "획기적인 AI 교육이 교실에 소개됐습니다.";
      break;
    case "body":
      post.body[0].sentences[0].text = "이 안내는 혁명적인 교육 방법을 소개합니다.";
      break;
    case "question":
      post.questions[0] = "최고의 AI 도구는 무엇일까요?";
      break;
    case "claim":
      post.claims[0].text = "이 안내는 압도적인 교육 성과를 만든다.";
      break;
  }
}

describe("결정론적 의미 품질 게이트", () => {
  it("차분하고 근거화된 기존 게시물을 통과시킨다", () => {
    const result = run();

    expect(result.semanticReview.passed).toBe(true);
    expect(result.qualityResult.passed).toBe(true);
    expect(result.qualityResult.blockingReasons).toEqual([]);
  });

  it.each(["title", "summary", "body", "question", "claim"])(
    "%s 영역의 보수적인 홍보·과장 표현을 차단한다",
    (target) => {
      const post = semanticPostFixture();
      setPromotionalText(post, target);

      const result = run(post);

      expect(result.semanticReview.passed).toBe(false);
      expect(result.qualityResult.blockingReasons).toContain(
        "PROMOTIONAL_LANGUAGE",
      );
    },
  );

  it("단일 RSS 요약으로 확정한 효과·전망 표현을 차단한다", () => {
    const post = semanticPostFixture();
    const evidence = semanticEvidenceFixture();
    post.oneLineSummary.text =
      "AI 활용으로 학습 효과가 향상될 것으로 예상됩니다.";
    post.claims[0].text = "AI 활용으로 학습 효과가 향상될 것으로 예상된다.";
    post.claims[0].evidenceRefs = [
      { evidenceId: "evidence-1", support: "context" },
    ];
    evidence[0].authority = "none";
    evidence[0].locator = "RSS 요약";

    const result = runSemanticQualityGate({ post, evidenceItems: evidence });

    expect(result.qualityResult.blockingReasons).toContain("CAUSAL_OVERREACH");
    expect(
      result.semanticReview.findings.some((finding) =>
        finding.message.includes("RSS 요약"),
      ),
    ).toBe(true);
  });

  it("서로 다른 publisher와 provenance가 연결된 효과 표현은 단일 출처 사유로 차단하지 않는다", () => {
    const post = semanticPostFixture();
    post.oneLineSummary.text =
      "AI 활용으로 학습 효과가 향상될 것으로 예상됩니다.";
    post.claims[0].text = "AI 활용으로 학습 효과가 향상될 것으로 예상된다.";

    const result = run(post);

    expect(result.qualityResult.blockingReasons).not.toContain(
      "CAUSAL_OVERREACH",
    );
  });

  it("같은 문장의 무관한 두 번째 claim 근거로 단일출처 인과 주장을 희석하지 못한다", () => {
    const post = semanticPostFixture();
    post.oneLineSummary.text =
      "AI 활용으로 학습 효과가 향상될 것으로 예상되며 안내가 공개됐습니다.";
    post.oneLineSummary.claimIds = ["claim-1", "claim-summary"];
    post.claims[1].text = "AI 활용으로 학습 효과가 향상될 것으로 예상된다.";
    post.claims[1].evidenceRefs = [
      { evidenceId: "evidence-1", support: "context" },
    ];

    const result = run(post);

    expect(result.qualityResult.blockingReasons).toContain("CAUSAL_OVERREACH");
    expect(result.semanticReview.findings).toContainEqual(
      expect.objectContaining({ claimIds: ["claim-1"] }),
    );
  });

  it("열린 질문의 효과 표현은 확정 주장으로 오인하지 않는다", () => {
    const post = semanticPostFixture();
    post.questions[0] = "AI가 학습 효과를 높일 것으로 예상할 수 있을까요?";

    const result = run(post);

    expect(result.qualityResult.blockingReasons).not.toContain(
      "CAUSAL_OVERREACH",
    );
  });

  it("다른 단어에 포함된 문자열을 홍보 표현으로 오인하지 않는다", () => {
    const post = semanticPostFixture();
    post.title = "학교 최고위원회가 살핀 AI 교육";

    const result = run(post);

    expect(result.qualityResult.blockingReasons).not.toContain(
      "PROMOTIONAL_LANGUAGE",
    );
  });

  it("claim의 숫자와 날짜가 연결된 passage에 있으면 통과시킨다", () => {
    const post = semanticPostFixture();
    const evidence = semanticEvidenceFixture();
    post.claims[1].text =
      "안내 자료는 2026년 8월 13일에 3개 원칙을 설명했다.";
    evidence[0].passage =
      "안내 자료는 2026년 8월 13일에 학생용 원칙 3개를 공개했다.";

    const result = runSemanticQualityGate({ post, evidenceItems: evidence });

    expect(result.qualityResult.blockingReasons).not.toContain(
      "UNSUPPORTED_CLAIM",
    );
  });

  it("claim의 숫자가 연결된 passage에 없으면 부분 문자열 매칭 없이 차단한다", () => {
    const post = semanticPostFixture();
    const evidence = semanticEvidenceFixture();
    post.claims[1].text = "안내 자료는 학생용 원칙 3개를 설명했다.";
    evidence[0].passage = "안내 자료는 학생용 원칙 13개를 설명했다.";

    const result = runSemanticQualityGate({ post, evidenceItems: evidence });

    expect(result.qualityResult.blockingReasons).toContain("UNSUPPORTED_CLAIM");
    expect(result.semanticReview.findings).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_CLAIM",
        claimIds: ["claim-1"],
      }),
    );
  });

  it("공개 문장에만 추가된 숫자도 연결 passage에 없으면 차단한다", () => {
    const post = semanticPostFixture();
    post.body[0].sentences[0].text =
      "안내 자료는 학생용 원칙 7개를 설명합니다.";

    const result = run(post);

    expect(result.qualityResult.blockingReasons).toContain("UNSUPPORTED_CLAIM");
  });

  it("퍼센트의 기호와 한글 표기를 같은 단위로 비교한다", () => {
    const post = semanticPostFixture();
    const evidence = semanticEvidenceFixture();
    post.claims[1].text = "참여율은 30%로 조사됐다.";
    evidence[0].passage = "수업 참여율은 30퍼센트로 조사됐다.";

    const result = runSemanticQualityGate({ post, evidenceItems: evidence });

    expect(result.qualityResult.blockingReasons).not.toContain(
      "UNSUPPORTED_CLAIM",
    );
  });

  it("계약과 현재 ID에 맞는 외부 evaluator finding을 병합한다", () => {
    const result = runSemanticQualityGate({
      post: semanticPostFixture(),
      evidenceItems: semanticEvidenceFixture(),
      evaluatorReview: externalSemanticFindingFixture(),
    });

    expect(result.semanticReview.findings).toContainEqual(
      expect.objectContaining({ code: "CONTRADICTED_CLAIM" }),
    );
    expect(result.qualityResult.blockingReasons).toContain(
      "CONTRADICTED_CLAIM",
    );
  });

  it("외부 evaluator 결과의 스키마 불일치를 SOURCE_CONFLICT로 차단한다", () => {
    const evaluatorReview = externalSemanticFindingFixture();
    evaluatorReview.passed = true;

    const result = runSemanticQualityGate({
      post: semanticPostFixture(),
      evidenceItems: semanticEvidenceFixture(),
      evaluatorReview,
    });

    expect(result.qualityResult.blockingReasons).toContain("SOURCE_CONFLICT");
  });

  it("외부 evaluator가 게시물에 없는 ID를 참조하면 fail-closed 한다", () => {
    const evaluatorReview = externalSemanticFindingFixture();
    evaluatorReview.findings[0].claimIds = ["claim-stale"];
    evaluatorReview.findings[0].evidenceIds = ["evidence-stale"];

    const result = runSemanticQualityGate({
      post: semanticPostFixture(),
      evidenceItems: semanticEvidenceFixture(),
      evaluatorReview,
    });

    expect(result.semanticReview.findings).toEqual([
      expect.objectContaining({ code: "SOURCE_CONFLICT" }),
    ]);
    expect(result.qualityResult.blockingReasons).toContain("SOURCE_CONFLICT");
  });

  it("외부 evaluator의 통과 결과가 결정론적 차단을 덮어쓰지 못한다", () => {
    const post = semanticPostFixture();
    post.title = "완벽한 AI 교육의 시작";

    const result = runSemanticQualityGate({
      post,
      evidenceItems: semanticEvidenceFixture(),
      evaluatorReview: {
        passed: true,
        evaluatorVersion: "fake-semantic-evaluator-v1",
        findings: [],
      },
    });

    expect(result.qualityResult.blockingReasons).toContain(
      "PROMOTIONAL_LANGUAGE",
    );
  });

  it("잘못된 게시물과 중복 근거 입력을 fail-closed 한다", () => {
    const invalidPost = semanticPostFixture();
    invalidPost.body = [];
    const invalidPostResult = run(invalidPost);
    const duplicateEvidence = semanticEvidenceFixture();
    duplicateEvidence.push(structuredClone(duplicateEvidence[0]));
    const duplicateEvidenceResult = runSemanticQualityGate({
      post: semanticPostFixture(),
      evidenceItems: duplicateEvidence,
    });

    expect(invalidPostResult.qualityResult.blockingReasons).toEqual([
      "SOURCE_CONFLICT",
    ]);
    expect(duplicateEvidenceResult.qualityResult.blockingReasons).toEqual([
      "SOURCE_CONFLICT",
    ]);
  });

  it("구조 품질 결과와 의미 품질 결과를 실패 보존 방식으로 병합한다", () => {
    const post = semanticPostFixture();
    post.title = "완벽한 AI 교육의 시작";
    const evidenceItems = semanticEvidenceFixture();
    const structural = validateGeneratedPost({
      post,
      evidenceItems,
      evidencePolicy: "primary_plus_independent",
    });
    const semantic = runSemanticQualityGate({ post, evidenceItems });

    const merged = mergeQualityResults(structural, semantic.qualityResult);

    expect(structural.passed).toBe(true);
    expect(merged.passed).toBe(false);
    expect(merged.blockingReasons).toContain("PROMOTIONAL_LANGUAGE");
  });

  it("계약을 어긴 품질 결과의 병합을 SOURCE_CONFLICT로 차단한다", () => {
    const malformed = {
      passed: true,
      checks: [],
      blockingReasons: [],
    } as unknown as QualityResult;

    const merged = mergeQualityResults(run().qualityResult, malformed);

    expect(merged.passed).toBe(false);
    expect(merged.blockingReasons).toContain("SOURCE_CONFLICT");
  });
});
