import { describe, expect, it } from "vitest";

import { evidenceItemSchema, graphemeLength } from "../../src/contracts";
import {
  createRssExcerptEvidenceItem,
  RSS_EXCERPT_MAX_GRAPHEMES,
} from "../../src/pipeline/retrieval";
import {
  candidateArticle,
  candidateSource,
} from "../fixtures/content/candidate";

describe("RSS excerpt 근거 후보", () => {
  it("RSS 요약만 source registry 메타데이터를 복사한 EvidenceItem으로 만든다", () => {
    const source = candidateSource();
    const article = candidateArticle(source, {
      excerpt:
        "<p>과학기술정보통신부는 초등학교 AI 교육 서비스가 개인정보를 다룰 때 지켜야 할 공식 원칙을 발표했다.</p><script>숨은 문장</script>",
    });

    const evidence = createRssExcerptEvidenceItem(article, source);

    expect(evidence).not.toBeNull();
    expect(evidenceItemSchema.safeParse(evidence).success).toBe(true);
    expect(evidence).toMatchObject({
      articleId: article.articleId,
      sourceId: source.sourceId,
      sourceRole: "primary",
      sourceType: "primary",
      authority: "none",
      locator: "RSS 요약",
    });
    expect(evidence?.passage).not.toContain("<p>");
    expect(evidence?.passage).not.toContain("숨은 문장");
  });

  it("excerpt가 없거나 너무 짧으면 근거 후보를 만들지 않는다", () => {
    const source = candidateSource();

    expect(
      createRssExcerptEvidenceItem(
        candidateArticle(source, { excerpt: null }),
        source,
      ),
    ).toBeNull();
    expect(
      createRssExcerptEvidenceItem(
        candidateArticle(source, { excerpt: "AI 교육 소식입니다." }),
        source,
      ),
    ).toBeNull();
  });

  it("길이를 제한하고 같은 입력에서 hash와 ID를 안정적으로 재현한다", () => {
    const source = candidateSource();
    const article = candidateArticle(source, {
      excerpt: "초등학교 AI 디지털 교육의 개인정보 보호 원칙을 설명했다. ".repeat(
        30,
      ),
    });

    const first = createRssExcerptEvidenceItem(article, source);
    const second = createRssExcerptEvidenceItem(article, source);

    expect(first).toEqual(second);
    expect(first).not.toBeNull();
    expect(graphemeLength(first?.passage ?? "")).toBeLessThanOrEqual(
      RSS_EXCERPT_MAX_GRAPHEMES,
    );
    expect(first?.passageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first?.evidenceId).toMatch(/^evidence:rss:/);
  });

  it("기사와 source metadata가 불일치하면 근거 후보를 만들지 않는다", () => {
    const source = candidateSource();
    const article = candidateArticle(source, {
      provenanceGroupKey: "origin-other:press-1",
    });

    expect(() => createRssExcerptEvidenceItem(article, source)).toThrow(
      /provenanceGroupKey/,
    );
  });

  it("공식 RSS의 효과나 전망을 덧붙이지 않고 excerpt 원문만 후보 passage로 둔다", () => {
    const source = candidateSource();
    const excerpt =
      "과학기술정보통신부는 초등학교 AI 교육의 안전한 사용을 위한 설명 자료를 공개했다고 밝혔다.";
    const evidence = createRssExcerptEvidenceItem(
      candidateArticle(source, { excerpt }),
      source,
    );

    expect(evidence?.passage).toBe(excerpt);
    expect(evidence?.authority).toBe("none");
  });
});
