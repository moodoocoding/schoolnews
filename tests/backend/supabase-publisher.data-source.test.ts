import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSupabasePublisherRpcDataSource,
  SupabaseClientPublisherRpcDataSource,
  SupabasePublisherConfigurationError,
} from "../../src/db/supabase/publisher.data-source";

describe("Supabase publisher RPC data source", () => {
  it("publish_post 이름과 매개변수만 주입된 RPC 호출 경계로 전달한다", async () => {
    const rpcCall = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const dataSource = new SupabaseClientPublisherRpcDataSource(rpcCall);
    const parameters = {
      p_run_date: "2026-08-12",
      p_validation_output_reference: "publication-output-1",
    };

    await expect(dataSource.rpc("publish_post", parameters)).resolves.toEqual({
      data: { ok: true },
      error: null,
    });
    expect(rpcCall).toHaveBeenCalledOnce();
    expect(rpcCall).toHaveBeenCalledWith("publish_post", parameters);
  });

  it("project origin과 server secret 형식을 생성 전에 검증한다", () => {
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
      expect(() => createSupabasePublisherRpcDataSource(input)).toThrow(
        SupabasePublisherConfigurationError,
      );
    }
  });
});
