import { describe, expect, it } from "vitest";

import type {
  ArticleInput,
  SourceCollectionOutcome,
  SourceRegistryEntry,
} from "../../src/contracts";
import { RSS_SOURCE_REGISTRY } from "../../src/pipeline/collectors";
import { runNewsIngestion } from "../../src/pipeline/orchestrator";
import { MemoryArticleRepository } from "../../src/repositories/article-memory.repository";

const source = RSS_SOURCE_REGISTRY[0];
const unavailableSource: SourceRegistryEntry = {
  ...source,
  sourceId: "unavailable-source",
  feedUrl: "https://unavailable.example.org/rss.xml",
  siteUrl: "https://unavailable.example.org/",
};

function article(overrides: Partial<ArticleInput> = {}): ArticleInput {
  return {
    sourceId: source.sourceId,
    externalId: "press-001",
    originalUrl:
      "https://www.msit.go.kr/bbs/view.do?bbsSeqNo=94&nttSeqNo=1&utm_source=test",
    title: "초등학교 AI 디지털 교육 개인정보 보호 지침 발표",
    excerpt:
      "초등학교 수업에서 인공지능 서비스를 사용할 때 학생의 개인정보와 안전을 확인하도록 하는 지침을 발표했습니다.",
    author: null,
    publisher: source.name,
    publishedAt: "2026-08-12T00:00:00+09:00",
    publishedAtPrecision: "date",
    discoveredAt: "2026-08-12T06:00:00+09:00",
    ...overrides,
  };
}

function outcomeFor(sourceId: string): SourceCollectionOutcome {
  if (sourceId === unavailableSource.sourceId) {
    return {
      sourceId,
      status: "failed",
      startedAt: "2026-08-12T06:00:00+09:00",
      finishedAt: "2026-08-12T06:00:01+09:00",
      items: [],
      issues: [
        {
          code: "SOURCE_UNAVAILABLE",
          message: "테스트용 수집원 장애입니다.",
          retryable: true,
          itemIndex: null,
        },
      ],
    };
  }

  return {
    sourceId,
    status: "succeeded",
    startedAt: "2026-08-12T06:00:00+09:00",
    finishedAt: "2026-08-12T06:00:01+09:00",
    items: [
      article(),
      article({
        externalId: "press-001-copy",
        originalUrl:
          "https://www.msit.go.kr/bbs/view.do?nttSeqNo=1&bbsSeqNo=94&utm_medium=rss#top",
      }),
    ],
    issues: [],
  };
}

describe("뉴스 수집 M2 통합", () => {
  it("한 소스가 실패해도 정상 소스를 정규화·중복 제거·근거 후보화한다", async () => {
    const repository = new MemoryArticleRepository();
    const result = await runNewsIngestion({
      articleRepository: repository,
      sources: [source, unavailableSource],
      collectSource: async (entry) => outcomeFor(entry.sourceId),
    });

    expect(result.status).toBe("partial");
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "succeeded",
      "failed",
    ]);
    expect(result.collectedCount).toBe(2);
    expect(result.normalizedCount).toBe(2);
    expect(result.deduplicatedCount).toBe(1);
    expect(result.storage).toEqual({
      insertedCount: 1,
      duplicateCount: 0,
      totalCount: 1,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].evidenceIds).toHaveLength(1);
    expect(result.candidates[0].score.aiDigitalSpecificity).toBeGreaterThanOrEqual(
      10,
    );
  });

  it("같은 결과를 재실행해도 저장 기사 수가 증가하지 않는다", async () => {
    const repository = new MemoryArticleRepository();
    const options = {
      articleRepository: repository,
      sources: [source],
      collectSource: async (entry: SourceRegistryEntry) =>
        outcomeFor(entry.sourceId),
    };

    const first = await runNewsIngestion(options);
    const second = await runNewsIngestion(options);

    expect(first.storage.insertedCount).toBe(1);
    expect(second.storage).toEqual({
      insertedCount: 0,
      duplicateCount: 1,
      totalCount: 1,
    });
    expect(await repository.count()).toBe(1);
  });

  it("모든 수집원이 실패하면 게시 후보 없이 실패 결과를 반환한다", async () => {
    const result = await runNewsIngestion({
      articleRepository: new MemoryArticleRepository(),
      sources: [unavailableSource],
      collectSource: async (entry) => outcomeFor(entry.sourceId),
    });

    expect(result.status).toBe("failed");
    expect(result.candidates).toEqual([]);
    expect(result.storage.totalCount).toBe(0);
  });

  it("수집기 예외와 잘못된 반환을 소스별 실패로 격리한다", async () => {
    const throwingSource = { ...unavailableSource, sourceId: "throwing-source" };
    const wrongOutcomeSource = {
      ...unavailableSource,
      sourceId: "wrong-outcome-source",
    };
    const result = await runNewsIngestion({
      articleRepository: new MemoryArticleRepository(),
      sources: [source, throwingSource, wrongOutcomeSource],
      collectSource: async (entry) => {
        if (entry.sourceId === throwingSource.sourceId) {
          throw new Error("collector crashed");
        }
        if (entry.sourceId === wrongOutcomeSource.sourceId) {
          return outcomeFor(unavailableSource.sourceId);
        }
        return outcomeFor(entry.sourceId);
      },
    });

    expect(result.status).toBe("partial");
    expect(result.deduplicatedCount).toBe(1);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "succeeded",
      "failed",
      "failed",
    ]);
    expect(result.outcomes[1].issues[0].code).toBe("INVALID_SOURCE_DATA");
    expect(result.outcomes[2].sourceId).toBe(wrongOutcomeSource.sourceId);
  });

  it("활성 수집원이 없으면 명시적인 실행 오류를 반환한다", async () => {
    const result = await runNewsIngestion({
      articleRepository: new MemoryArticleRepository(),
      sources: [],
    });

    expect(result.status).toBe("failed");
    expect(result.runIssues).toEqual([
      {
        code: "NO_ENABLED_SOURCE",
        message: "활성화된 뉴스 수집원이 없습니다.",
      },
    ]);
  });

  it("상위 실행 중단 신호를 수집기까지 전달하고 전체 실행을 중단한다", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const promise = runNewsIngestion({
      articleRepository: new MemoryArticleRepository(),
      sources: [source],
      abortSignal: controller.signal,
      collectSource: async (_entry, signal) => {
        receivedSignal = signal;
        controller.abort();
        return outcomeFor(source.sourceId);
      },
    });

    await expect(promise).rejects.toMatchObject({
      name: "NewsIngestionAbortedError",
    });
    expect(receivedSignal).toBe(controller.signal);
  });
});
