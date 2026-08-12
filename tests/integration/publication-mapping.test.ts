import { describe, expect, it } from "vitest";

import {
  isPublishedPostDerivedFromGeneration,
  mapValidatedGenerationToPublishedPost,
  PublicationMappingError,
} from "../../src/pipeline/orchestrator/publication-mapping";
import {
  evidenceItemsFixture,
  generatedPostFixture,
} from "../fixtures/contracts";

const passedQuality = {
  passed: true as const,
  checks: [
    {
      type: "publication-contract",
      passed: true,
      reasons: [],
      checkerVersion: "publication-contract-v1",
    },
  ],
  blockingReasons: [],
};

const identity = {
  id: "post-20260812",
  slug: "ai-check-before-use",
  publicationDateKst: "2026-08-12",
  publishedAt: "2026-08-12T07:00:00+09:00",
  modifiedAt: "2026-08-12T07:00:00+09:00",
  visual: {
    kind: "pattern" as const,
    seed: "post-20260812-visual-seed",
    templateVersion: "gallery-v1",
  },
};

function mapPost() {
  return mapValidatedGenerationToPublishedPost({
    identity,
    generatedPost: structuredClone(generatedPostFixture),
    qualityResult: structuredClone(passedQuality),
    evidenceItems: structuredClone(evidenceItemsFixture),
  });
}

describe("검증 생성물의 공개 게시물 변환", () => {
  it("문장-주장-근거 그래프와 출처를 결정론적으로 투영한다", () => {
    const post = mapPost();

    expect(post.oneLineSummary.sourceIds).toEqual([
      "evidence-1",
      "evidence-2",
    ]);
    expect(post.body.map((paragraph) => paragraph.claims[0].sourceIds)).toEqual([
      ["evidence-1"],
      ["evidence-2"],
      ["evidence-2"],
    ]);
    expect(post.sources.map((source) => source.id)).toEqual([
      "evidence-1",
      "evidence-2",
    ]);
    expect(
      isPublishedPostDerivedFromGeneration({
        publishedPost: post,
        generatedPost: generatedPostFixture,
        qualityResult: passedQuality,
        evidenceItems: evidenceItemsFixture,
      }),
    ).toBe(true);
  });

  it("생성 문장·출처와 다른 공개 콘텐츠를 거부한다", () => {
    const post = mapPost();
    post.body[0].claims[0].text = "생성 결과와 관계없는 공개 문장입니다.";

    expect(
      isPublishedPostDerivedFromGeneration({
        publishedPost: post,
        generatedPost: generatedPostFixture,
        qualityResult: passedQuality,
        evidenceItems: evidenceItemsFixture,
      }),
    ).toBe(false);
  });

  it("품질 실패와 누락 근거를 공개 형식으로 만들지 않는다", () => {
    expect(() =>
      mapValidatedGenerationToPublishedPost({
        identity,
        generatedPost: generatedPostFixture,
        qualityResult: {
          passed: false,
          checks: [
            {
              type: "publication-contract",
              passed: false,
              reasons: ["blocked"],
              checkerVersion: "publication-contract-v1",
            },
          ],
          blockingReasons: ["FORMAT_INVALID"],
        },
        evidenceItems: evidenceItemsFixture,
      }),
    ).toThrow(PublicationMappingError);

    expect(() =>
      mapValidatedGenerationToPublishedPost({
        identity,
        generatedPost: generatedPostFixture,
        qualityResult: passedQuality,
        evidenceItems: evidenceItemsFixture.slice(0, 1),
      }),
    ).toThrow(PublicationMappingError);

    const evidenceWithoutPublicationDate = structuredClone(evidenceItemsFixture);
    delete (evidenceWithoutPublicationDate[0] as { publishedAt?: string })
      .publishedAt;
    expect(() =>
      mapValidatedGenerationToPublishedPost({
        identity,
        generatedPost: generatedPostFixture,
        qualityResult: passedQuality,
        evidenceItems: evidenceWithoutPublicationDate,
      }),
    ).toThrow(PublicationMappingError);
  });
});
