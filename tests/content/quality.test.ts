import { describe, expect, it } from "vitest";

import { validateGeneratedPost } from "../../src/pipeline/quality";
import {
  authoritativeSingleSourcePost,
  validEvidenceItems,
  validGeneratedPost,
} from "../fixtures/content/quality";

describe("생성 게시물 1차 품질 게이트", () => {
  it("공식 1차 자료와 독립 보도로 근거화된 게시물을 통과시킨다", () => {
    const result = validateGeneratedPost({
      post: validGeneratedPost(),
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(true);
    expect(result.blockingReasons).toEqual([]);
  });

  it("스키마 오류를 FORMAT_INVALID로 차단한다", () => {
    const post = validGeneratedPost();
    post.body = post.body.slice(0, 2);

    const result = validateGeneratedPost({
      post,
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("FORMAT_INVALID");
    expect(result.blockingReasons).not.toContain("CONTENT_TOO_LONG");
  });

  it("허용 길이를 넘는 콘텐츠를 CONTENT_TOO_LONG으로 차단한다", () => {
    const post = validGeneratedPost();
    post.body[0].sentences[0].text = "가".repeat(261);

    const result = validateGeneratedPost({
      post,
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("CONTENT_TOO_LONG");
  });

  it("기사로 읽기에 너무 짧은 본문을 CONTENT_TOO_SHORT로 차단한다", () => {
    const post = validGeneratedPost();
    post.body.forEach((paragraph, index) => {
      paragraph.sentences = [
        {
          sentenceId: `short-sentence-${index + 1}`,
          text: "핵심 내용을 확인합니다.",
          claimIds: [`claim-${index + 1}`],
        },
      ];
    });

    const result = validateGeneratedPost({
      post,
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("CONTENT_TOO_SHORT");
    expect(result.blockingReasons).not.toContain("CONTENT_TOO_LONG");
  });

  it("존재하지 않는 evidence ID를 MISSING_EVIDENCE로 차단한다", () => {
    const post = validGeneratedPost();
    post.claims[1].evidenceRefs = [
      { evidenceId: "evidence-missing", support: "direct" },
    ];
    post.usedEvidenceIds = ["evidence-1", "evidence-2", "evidence-missing"];

    const result = validateGeneratedPost({
      post,
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("MISSING_EVIDENCE");
  });

  it("독립적인 출처가 부족하면 차단한다", () => {
    const evidenceItems = validEvidenceItems();
    evidenceItems[1].publisherGroupId = evidenceItems[0].publisherGroupId;
    evidenceItems[1].provenanceGroupKey = evidenceItems[0].provenanceGroupKey;

    const result = validateGeneratedPost({
      post: validGeneratedPost(),
      evidenceItems,
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("INSUFFICIENT_INDEPENDENT_SOURCES");
  });

  it("단일 출처 예외을 기본적으로 허용하지 않는다", () => {
    const result = validateGeneratedPost({
      post: authoritativeSingleSourcePost(),
      evidenceItems: [validEvidenceItems()[0]],
      evidencePolicy: "authoritative_single_source",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("INSUFFICIENT_INDEPENDENT_SOURCES");
  });

  it("권한 있는 1차 자료임이 확인된 단일 출처만 예외로 통과시킨다", () => {
    const result = validateGeneratedPost({
      post: authoritativeSingleSourcePost(),
      evidenceItems: [validEvidenceItems()[0]],
      evidencePolicy: "authoritative_single_source",
      allowAuthoritativeSingleSource: true,
    });

    expect(result.passed).toBe(true);
  });

  it("승인된 단일 출처로도 해석 주장은 허용하지 않는다", () => {
    const post = authoritativeSingleSourcePost();
    post.claims[3].kind = "interpretation";

    const result = validateGeneratedPost({
      post,
      evidenceItems: [validEvidenceItems()[0]],
      evidencePolicy: "authoritative_single_source",
      allowAuthoritativeSingleSource: true,
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("INSUFFICIENT_INDEPENDENT_SOURCES");
  });

  it("usedEvidenceIds가 주장의 근거와 다르면 차단한다", () => {
    const post = validGeneratedPost();
    post.usedEvidenceIds = ["evidence-1"];

    const result = validateGeneratedPost({
      post,
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("FORMAT_INVALID");
  });

  it("usedEvidenceIds의 중복을 형식 오류로 차단한다", () => {
    const post = validGeneratedPost();
    post.usedEvidenceIds = ["evidence-1", "evidence-2", "evidence-2"];

    const result = validateGeneratedPost({
      post,
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("FORMAT_INVALID");
  });

  it("근거 연결이 없는 사실 주장을 차단한다", () => {
    const post = validGeneratedPost();
    post.claims[1].evidenceRefs = [];

    const result = validateGeneratedPost({
      post,
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("UNSUPPORTED_CLAIM");
  });

  it("공개 문장에 쓰인 해석 주장도 하나 이상의 근거 연결을 요구한다", () => {
    const post = validGeneratedPost();
    post.claims[1].kind = "interpretation";
    post.claims[1].evidenceRefs = [];

    const result = validateGeneratedPost({
      post,
      evidenceItems: validEvidenceItems(),
      evidencePolicy: "primary_plus_independent",
    });

    expect(result.passed).toBe(false);
    expect(result.blockingReasons).toContain("UNSUPPORTED_CLAIM");
  });
});
