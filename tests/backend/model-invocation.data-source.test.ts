import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSupabaseModelInvocationRpcDataSource,
  SupabaseClientModelInvocationRpcDataSource,
  SupabaseModelInvocationConfigurationError,
} from "../../src/db/supabase/model-invocation.data-source";

describe("Supabase model invocation data source", () => {
  it("세 개의 허용된 RPC 이름과 parameters만 전달한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const dataSource = new SupabaseClientModelInvocationRpcDataSource(rpcCall);
    const parameters = { p_run_id: "daily-20260813", p_route_attempt: 1 };

    await expect(
      dataSource.rpc("prepare_model_invocation", parameters),
    ).resolves.toEqual({ data: { ok: true }, error: null });
    await dataSource.rpc("finalize_model_invocation", parameters);
    await dataSource.rpc("get_model_invocation", parameters);

    expect(rpcCall).toHaveBeenNthCalledWith(
      1,
      "prepare_model_invocation",
      parameters,
    );
    expect(rpcCall).toHaveBeenNthCalledWith(
      2,
      "finalize_model_invocation",
      parameters,
    );
    expect(rpcCall).toHaveBeenNthCalledWith(
      3,
      "get_model_invocation",
      parameters,
    );
  });

  it("project origin과 server secret 형식을 client 생성 전에 검증한다", () => {
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
      expect(() => createSupabaseModelInvocationRpcDataSource(input)).toThrow(
        SupabaseModelInvocationConfigurationError,
      );
    }
  });

  it("local loopback HTTP Supabase origin은 허용한다", () => {
    expect(() =>
      createSupabaseModelInvocationRpcDataSource({
        projectUrl: "http://127.0.0.1:54321",
        secretKey: "sb_secret_valid-enough-placeholder",
      }),
    ).not.toThrow();
  });
});
