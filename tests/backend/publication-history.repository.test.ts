import { describe, expect, it } from "vitest";

import {
  SupabasePublicationHistoryError,
  SupabasePublicationHistoryRepository,
  type SupabasePublicationHistoryRpcDataSource,
  type SupabasePublicationHistoryRpcResult,
} from "../../src/repositories/supabase-publication-history.repository";

class FakeDataSource implements SupabasePublicationHistoryRpcDataSource {
  readonly calls: Array<Readonly<Record<string, unknown>>> = [];
  constructor(private readonly result: SupabasePublicationHistoryRpcResult) {}
  async rpc(_name: "get_publication_history", parameters: Readonly<Record<string, unknown>>) {
    this.calls.push(parameters);
    return this.result;
  }
}

describe("SupabasePublicationHistoryRepository", () => {
  it("제한된 최근 제목·fingerprint를 exact RPC로 읽는다", async () => {
    const source = new FakeDataSource({
      data: { titles: ["최근 글"], contentFingerprints: ["a".repeat(64)], latestPublicationDateKst: "2026-08-13" },
      error: null,
    });
    await expect(new SupabasePublicationHistoryRepository(source).getRecent(30))
      .resolves.toEqual({ titles: ["최근 글"], contentFingerprints: ["a".repeat(64)], latestPublicationDateKst: "2026-08-13" });
    expect(source.calls).toEqual([{ p_limit: 30 }]);
  });

  it("invalid limit은 RPC 전에 차단한다", async () => {
    const source = new FakeDataSource({ data: null, error: null });
    for (const limit of [0, 366, 1.5]) {
      await expect(new SupabasePublicationHistoryRepository(source).getRecent(limit))
        .rejects.toMatchObject({ code: "INVALID_HISTORY_LIMIT" });
    }
    expect(source.calls).toHaveLength(0);
  });

  it("duplicate·malformed·over-limit 응답을 fail closed 한다", async () => {
    for (const data of [
      { titles: ["글"], contentFingerprints: ["a".repeat(64), "a".repeat(64)], latestPublicationDateKst: "2026-08-13" },
      { titles: [], contentFingerprints: ["not-a-hash"], latestPublicationDateKst: null },
      { titles: ["글", "둘"], contentFingerprints: [], latestPublicationDateKst: "2026-08-13" },
    ]) {
      await expect(
        new SupabasePublicationHistoryRepository(
          new FakeDataSource({ data, error: null }),
        ).getRecent(data.titles.length === 2 ? 1 : 365),
      ).rejects.toMatchObject({ code: "INVALID_HISTORY_RESPONSE" });
    }
  });

  it("permission과 unknown 오류에서 원문을 노출하지 않는다", async () => {
    for (const [code, expected] of [
      ["42501", "RPC_PERMISSION_DENIED"],
      ["XX000", "HISTORY_LOOKUP_UNAVAILABLE"],
    ] as const) {
      const operation = new SupabasePublicationHistoryRepository(
        new FakeDataSource({ data: null, error: { code, message: "secret row" } }),
      ).getRecent();
      try {
        await operation;
        throw new Error("expected");
      } catch (error) {
        expect(error).toBeInstanceOf(SupabasePublicationHistoryError);
        expect(error).toMatchObject({ code: expected });
        expect(JSON.stringify(error)).not.toContain("secret row");
      }
    }
  });
});
