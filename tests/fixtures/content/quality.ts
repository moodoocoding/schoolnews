import { createHash } from "node:crypto";

import type {
  ArticleModelDocument,
  EvidenceItem,
  GeneratedPost,
} from "../../../src/contracts";
import {
  evidenceItemsFixture,
  generatedPostFixture,
} from "../contracts";

export function validEvidenceItems(): EvidenceItem[] {
  return structuredClone(evidenceItemsFixture);
}

export function validArticleDocuments(): ArticleModelDocument[] {
  return evidenceItemsFixture.map((evidence, index) => {
    const contentText =
      index === 0
        ? "한국교육학술정보원은 학생의 발달 단계에 맞춘 AI 활용 원칙과 교사의 확인 절차를 안내했다. AI 결과를 사용할 때는 학습 목표와 출처, 오류 가능성을 함께 살펴야 한다는 내용이 담겼다. 안내 자료는 도구를 먼저 선택하기보다 학습에 필요한 도움이 무엇인지 확인하는 절차를 설명했다."
        : "교육뉴스는 초등학교의 AI 활용 원칙을 살펴봤다. 학교는 AI가 만든 결과를 그대로 쓰지 않고 출처와 오류를 확인하는 활동을 강조했다. 기사는 생성 결과의 빠른 활용과 학습자의 판단 과정 사이에 긴장이 있음을 설명했다. 확인 과정을 줄이면 편리해지지만, 학생이 정보를 비교하고 판단할 기회도 줄어들 수 있다는 점을 짚었다.";
    return {
      documentKind: "reviewed_full_text" as const,
      documentId: `document-${index + 1}`,
      articleId: evidence.articleId,
      sourceId: evidence.sourceId,
      evidenceId: evidence.evidenceId,
      sourceName: evidence.sourceName,
      title: evidence.title,
      publishedAt: evidence.publishedAt,
      contentText,
      contentHash: createHash("sha256").update(contentText).digest("hex"),
      fetchedAt: "2026-08-12T00:00:00.000Z",
      retentionExpiresAt: "2026-09-11T00:00:00.000Z",
      rightsBasisUrl: "https://example.com/terms/news-use",
      termsReviewedAt: "2026-08-12T00:00:00.000Z",
    };
  });
}

export function validGeneratedPost(): GeneratedPost {
  return structuredClone(generatedPostFixture);
}

export function authoritativeSingleSourcePost(): GeneratedPost {
  const post = validGeneratedPost();

  for (const claim of post.claims) {
    claim.kind = "fact";
    claim.evidenceRefs = [{ evidenceId: "evidence-1", support: "direct" }];
  }
  post.usedEvidenceIds = ["evidence-1"];

  return post;
}
