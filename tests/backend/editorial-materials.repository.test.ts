import { describe, expect, it } from "vitest";

import {
  SupabaseEditorialMaterialsError,
  SupabaseEditorialMaterialsRepository,
  type SupabaseEditorialMaterialsRpcDataSource,
} from "../../src/repositories";
import { normalizedArticleSchema } from "../../src/contracts";

const article = normalizedArticleSchema.parse({
  sourceId: "source-one",
  externalId: "one",
  originalUrl: "https://example.com/one",
  title: "AI 기술과 교육의 변화",
  excerpt: "확인된 요약입니다.",
  author: null,
  publisher: "테스트",
  publishedAt: "2026-08-13T12:00:00+09:00",
  publishedAtPrecision: "instant",
  discoveredAt: "2026-08-13T13:00:00+09:00",
  articleId: "article-one",
  publisherGroupId: "publisher-one",
  provenanceGroupKey: "provenance:one",
  canonicalUrl: "https://example.com/one",
  canonicalUrlHash: "a".repeat(64),
  normalizedTitle: "AI 기술과 교육의 변화",
  contentFingerprint: "b".repeat(64),
  canonicalizationVersion: "test-v1",
  fingerprintVersion: "test-v1",
  originType: "original_reporting",
});

class FakeSource implements SupabaseEditorialMaterialsRpcDataSource {
  calls: Array<Record<string, unknown>> = [];
  constructor(readonly data: unknown) {}
  async rpc(_name: "get_rolling_editorial_materials", parameters: Readonly<Record<string, unknown>>) {
    this.calls.push({ ...parameters });
    return { data: this.data, error: null };
  }
}

describe("SupabaseEditorialMaterialsRepository", () => {
  it("run date와 7일 창을 exact RPC로 읽는다", async () => {
    const source = new FakeSource({ articles: [article], evidenceItems: [] });
    await expect(
      new SupabaseEditorialMaterialsRepository(source).getRolling({
        runDate: "2026-08-14",
        windowDays: 7,
      }),
    ).resolves.toEqual({ articles: [article], evidenceItems: [] });
    expect(source.calls).toEqual([{ p_run_date: "2026-08-14", p_window_days: 7 }]);
  });

  it("잘못된 입력·응답은 RPC 전후 fail closed 한다", async () => {
    const source = new FakeSource({ articles: "bad", evidenceItems: [] });
    await expect(
      new SupabaseEditorialMaterialsRepository(source).getRolling({ runDate: "bad", windowDays: 8 }),
    ).rejects.toBeInstanceOf(SupabaseEditorialMaterialsError);
    expect(source.calls).toHaveLength(0);
    await expect(
      new SupabaseEditorialMaterialsRepository(source).getRolling({ runDate: "2026-08-14", windowDays: 7 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
