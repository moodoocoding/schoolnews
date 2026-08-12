import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseClientDailyRunRpcDataSource } from "../../src/db/supabase/daily-run.data-source";

describe("SupabaseClientDailyRunRpcDataSource", () => {
  it("허용된 RPC 이름과 매개변수만 주입된 호출 경계로 전달한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({ data: null, error: null });
    const dataSource = new SupabaseClientDailyRunRpcDataSource(rpcCall);
    const parameters = { p_run_date: "2026-08-13" };

    await expect(dataSource.rpc("get_daily_run", parameters)).resolves.toEqual({
      data: null,
      error: null,
    });
    expect(rpcCall).toHaveBeenCalledOnce();
    expect(rpcCall).toHaveBeenCalledWith("get_daily_run", parameters);
  });

  it("RPC 오류를 저장소 계층이 판정할 수 있도록 그대로 반환한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "FENCE_MISMATCH", message: "FENCE_MISMATCH" },
    });
    const dataSource = new SupabaseClientDailyRunRpcDataSource(rpcCall);

    await expect(
      dataSource.rpc("finish_daily_run", {}),
    ).resolves.toEqual({
      data: null,
      error: { code: "FENCE_MISMATCH", message: "FENCE_MISMATCH" },
    });
  });
});
