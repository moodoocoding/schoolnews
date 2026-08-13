import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseClientSourceAttemptRpcDataSource } from "../../src/db/supabase/source-attempt.data-source";

describe("Supabase source attempt RPC data source", () => {
  it("허용 RPC 이름과 매개변수만 주입된 경계로 전달한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({ data: null, error: null });
    const dataSource = new SupabaseClientSourceAttemptRpcDataSource(rpcCall);
    const parameters = {
      p_source_id: "msit-press-release",
      p_min_interval_ms: 86_400_000,
    };

    await expect(
      dataSource.rpc("reserve_source_collection_attempt", parameters),
    ).resolves.toEqual({ data: null, error: null });
    expect(rpcCall).toHaveBeenCalledWith(
      "reserve_source_collection_attempt",
      parameters,
    );
  });
});
