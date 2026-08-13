import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSupabasePublicationHistoryRpcDataSource,
  SupabaseClientPublicationHistoryRpcDataSource,
  SupabasePublicationHistoryConfigurationError,
} from "../../src/db/supabase/publication-history.data-source";

describe("publication history data source", () => {
  it("RPC 경계를 그대로 전달한다", async () => {
    const call = vi.fn().mockResolvedValue({ data: { titles: [], contentFingerprints: [], latestPublicationDateKst: null }, error: null });
    const source = new SupabaseClientPublicationHistoryRpcDataSource(call);
    await source.rpc("get_publication_history", { p_limit: 20 });
    expect(call).toHaveBeenCalledWith("get_publication_history", { p_limit: 20 });
  });

  it("server secret과 project origin을 생성 전에 검증한다", () => {
    for (const input of [
      { projectUrl: "http://example.com", secretKey: "sb_secret_valid-enough-placeholder" },
      { projectUrl: "https://example.com/path", secretKey: "sb_secret_valid-enough-placeholder" },
      { projectUrl: "https://example.com", secretKey: "sb_publishable_not-secret" },
    ]) {
      expect(() => createSupabasePublicationHistoryRpcDataSource(input))
        .toThrow(SupabasePublicationHistoryConfigurationError);
    }
  });
});
