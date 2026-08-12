import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSupabaseContentPersistenceRpcDataSource,
  SupabaseClientContentPersistenceRpcDataSource,
  SupabaseContentPersistenceConfigurationError,
} from "../../src/db/supabase/content-persistence.data-source";

describe("Supabase content persistence RPC data source", () => {
  it("허용된 RPC 이름과 parameter object만 주입 경계에 전달한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({ data: { created: true }, error: null });
    const dataSource = new SupabaseClientContentPersistenceRpcDataSource(rpcCall);
    const parameters = { p_run_date: "2026-08-13", p_run_id: "run-1" };

    await expect(
      dataSource.rpc("persist_empty_topic_selection", parameters),
    ).resolves.toEqual({ data: { created: true }, error: null });
    expect(rpcCall).toHaveBeenCalledWith("persist_empty_topic_selection", parameters);
  });

  it("HTTPS project origin과 server Secret Key를 생성 전에 검증한다", () => {
    for (const input of [
      {
        projectUrl: "http://example.supabase.co",
        secretKey: "sb_secret_valid-enough-placeholder",
      },
      {
        projectUrl: "https://example.supabase.co/path",
        secretKey: "sb_secret_valid-enough-placeholder",
      },
      {
        projectUrl: "https://example.supabase.co",
        secretKey: "sb_publishable_not-a-server-secret",
      },
    ]) {
      expect(() => createSupabaseContentPersistenceRpcDataSource(input)).toThrow(
        SupabaseContentPersistenceConfigurationError,
      );
    }
  });
});
